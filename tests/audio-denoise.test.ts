import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { checkAudioQuality, prepareDenoisedAudio } from '../scripts/audio-denoise';

const original = { duration: 120, channels: 1, sampleRate: 24000, rmsDb: -24, peakDb: -3 };
const valid = { ...original, bytes: 480_000, rmsDb: -26, peakDb: -4 };

test('降噪发布门禁拒绝截短、静音、音量过降、削波和超限文件', () => {
  assert.deepEqual(checkAudioQuality(original, valid), []);
  for (const change of [{ duration: 119 }, { rmsDb: -70 }, { rmsDb: -32 }, { peakDb: 0 }, { bytes: 21 * 1024 * 1024 }, { channels: 2 }, { sampleRate: 48000 }, { duration: NaN }]) {
    assert.ok(checkAudioQuality(original, { ...valid, ...change }).length > 0, JSON.stringify(change));
  }
});

test('真实 FFmpeg 降噪：原件不变、可解码、重复复用、损坏阻断', { skip: !process.env.FFMPEG_PATH }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ddj-audio-check-'));
  const input = path.join(directory, 'source.wav');
  const ffmpeg = process.env.FFMPEG_PATH!;
  try {
    await promisify(execFile)(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.15*sin(2*PI*440*t)+0.015*sin(2*PI*50*t)+0.008*(2*random(0)-1):s=24000:d=3', '-n', input]);
    const originalBytes = await readFile(input);
    const first = await prepareDenoisedAudio(input, { outputRoot: path.join(directory, 'results'), ffmpeg });
    assert.equal(first.checks, 'passed');
    assert.equal(first.preset.version, 'speech-gentle-v1');
    assert.deepEqual(await readFile(input), originalBytes);
    const second = await prepareDenoisedAudio(input, { outputRoot: path.join(directory, 'results'), ffmpeg });
    assert.equal(first.output, second.output);
    assert.equal(first.outputSha256, second.outputSha256);
    await writeFile(first.output, 'corrupted output');
    await assert.rejects(prepareDenoisedAudio(input, { outputRoot: path.join(directory, 'results'), ffmpeg }), /校验失败/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('缺少处理工具时明确失败，不能冒充降噪成功', async () => {
  await assert.rejects(prepareDenoisedAudio(new URL('./audio-denoise.test.ts', import.meta.url).pathname, { ffmpeg: '/nonexistent/ffmpeg' }), /无法运行 FFmpeg/);
});
