import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFile } from 'music-metadata';

// Versioned, deliberately gentle speech cleanup. No gate, silence trimming or speed changes.
export const denoisePreset = {
  version: 'speech-gentle-v1',
  filter: 'highpass=f=60,afftdn=nr=6:nf=-50:tn=1:gs=8',
  bitrateKbps: 32,
  maxBytes: 20 * 1024 * 1024,
} as const;

async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function run(executable: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000);
    timeout.unref();
    let output = '';
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-64_000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', error => { clearTimeout(timeout); reject(new Error(`无法运行 FFmpeg；请安装或配置 FFMPEG_PATH。${error.message}`)); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(`FFmpeg 未完成（${code}）：${output.slice(-1500)}`)); });
  });
}

type Levels = { rmsDb: number; peakDb: number };
async function levels(ffmpeg: string, file: string): Promise<Levels> {
  const output = await run(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-xerror', '-i', file, '-map', '0:a:0', '-vn', '-af', 'astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level', '-f', 'null', '-']);
  const rmsDb = Number(output.match(/RMS level dB:\s*([\d.+-]+|[-+]inf)/)?.[1]);
  const peakDb = Number(output.match(/Peak level dB:\s*([\d.+-]+|[-+]inf)/)?.[1]);
  if (!Number.isFinite(rmsDb) || !Number.isFinite(peakDb)) throw new Error('无法测量有效音频电平，禁止发布');
  return { rmsDb, peakDb };
}

export function checkAudioQuality(input: { duration: number; channels: number; sampleRate: number } & Levels, output: { duration: number; channels: number; sampleRate: number; bytes: number } & Levels) {
  const failures = [];
  if (![input.duration, output.duration, input.rmsDb, output.rmsDb, input.peakDb, output.peakDb].every(Number.isFinite) || input.duration <= 0 || output.duration <= 0) failures.push('无效时长或电平');
  if (Math.abs(input.duration - output.duration) > 0.25) failures.push('时长变化超过 0.25 秒');
  if (input.channels !== output.channels || input.sampleRate !== output.sampleRate) failures.push('声道或采样率变化');
  if (input.rmsDb < -65 || output.rmsDb < -65 || input.rmsDb - output.rmsDb > 6 || output.rmsDb - input.rmsDb > 1) failures.push('音量异常或衰减过大');
  if (output.peakDb >= 0) failures.push('峰值达到削波边界');
  if (output.bytes <= 0 || output.bytes > denoisePreset.maxBytes) failures.push('输出为空或超过 20 MB');
  return failures;
}

export type DenoisedAudio = {
  status: 'ready'; input: string; output: string; inputSha256: string; outputSha256: string;
  preset: typeof denoisePreset; ffmpegVersion: string;
  inputMetrics: { duration: number; channels: number; sampleRate: number } & Levels;
  outputMetrics: { duration: number; channels: number; sampleRate: number; bytes: number } & Levels;
  checks: 'passed'; perceptualQuality: 'not-automatically-certified';
};

export async function prepareDenoisedAudio(input: string, options: { outputRoot?: string; ffmpeg?: string } = {}): Promise<DenoisedAudio> {
  const source = path.resolve(input);
  const root = path.resolve(options.outputRoot || '.local/imports/audio/denoised');
  const ffmpeg = options.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  if (!(await stat(source)).isFile()) throw new Error('音频来源必须是本地文件');
  const inputSha256 = await hashFile(source);
  const ffmpegVersion = (await run(ffmpeg, ['-version'])).split('\n')[0];
  const key = createHash('sha256').update(JSON.stringify({ inputSha256, preset: denoisePreset, ffmpegVersion })).digest('hex');
  const target = path.join(root, key);
  const manifestPath = path.join(target, 'manifest.json');
  const cached = async () => {
    let saved: DenoisedAudio;
    try { saved = JSON.parse(await readFile(manifestPath, 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    const output = path.join(target, 'denoised.mp3');
    if (saved.status !== 'ready' || saved.inputSha256 !== inputSha256 || saved.checks !== 'passed' || saved.outputSha256 !== await hashFile(output)) throw new Error('已有降噪结果校验失败；保留原件，禁止自动导入');
    return { ...saved, input: source, output };
  };
  await mkdir(root, { recursive: true, mode: 0o700 });
  const hit = await cached(); if (hit) return hit;
  const lock = `${target}.lock`;
  try { await mkdir(lock); } catch (error: any) { if (error.code === 'EEXIST') throw new Error('同一音频正在处理，稍后重试；不会重复处理'); throw error; }
  let working: string | undefined;
  try {
    const secondHit = await cached(); if (secondHit) return secondHit;
    working = await mkdtemp(path.join(root, '.processing-'));
    const candidate = path.join(working, 'denoised.mp3');
    const metadata = (await parseFile(source, { duration: true })).format;
    const { duration, sampleRate, numberOfChannels: channels } = metadata;
    if (!duration || !sampleRate || !channels) throw new Error('原音频缺少可验证的时长、采样率或声道');
    if (duration * denoisePreset.bitrateKbps * 125 > denoisePreset.maxBytes - 100_000) throw new Error('预计输出超过 20 MB，需另行确认编码方案；不自动截短音频');
    const inputMetrics = { duration, sampleRate, channels, ...await levels(ffmpeg, source) };
    await run(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-v', 'error', '-xerror', '-i', source, '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-af', denoisePreset.filter, '-c:a', 'libmp3lame', '-b:a', `${denoisePreset.bitrateKbps}k`, '-ar', String(sampleRate), '-ac', String(channels), '-n', candidate]);
    const result = (await parseFile(candidate, { duration: true })).format;
    const outputMetrics = { duration: result.duration || 0, sampleRate: result.sampleRate || 0, channels: result.numberOfChannels || 0, bytes: (await stat(candidate)).size, ...await levels(ffmpeg, candidate) };
    const failures = checkAudioQuality(inputMetrics, outputMetrics);
    if (failures.length) throw new Error(`降噪校验未通过：${failures.join('；')}`);
    if (await hashFile(source) !== inputSha256) throw new Error('处理期间来源文件改变，禁止导入');
    const manifest: DenoisedAudio = { status: 'ready', input: source, output: path.join(target, 'denoised.mp3'), inputSha256, outputSha256: await hashFile(candidate), preset: denoisePreset, ffmpegVersion, inputMetrics, outputMetrics, checks: 'passed', perceptualQuality: 'not-automatically-certified' };
    await writeFile(path.join(working, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await rename(working, target); working = undefined;
    return manifest;
  } finally {
    if (working) await rm(working, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const input = process.argv[2];
  if (!input) throw new Error('用法：npm run audio:denoise -- <本地音频路径> [输出根目录]');
  const result = await prepareDenoisedAudio(input, { outputRoot: process.argv[3] });
  console.log(JSON.stringify(result, null, 2));
}
