import crypto from 'node:crypto';
import { ApiError } from '../config';

export interface VerificationProvider {
  sendEmail(to: string, code: string, purpose: string): Promise<void>;
  sendPhone(phone: string, reference: string): Promise<void>;
  checkPhone(phone: string, code: string, reference: string): Promise<boolean>;
}
function configured(names: string[]) { if (!names.every(key => process.env[key])) throw new ApiError(503, '验证服务暂未开放，请稍后再试', 'VERIFICATION_UNCONFIGURED'); }
async function phoneClient() {
  configured(['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_PNVS_SIGN_NAME', 'ALIBABA_PNVS_TEMPLATE_CODE']);
  const Dypnsapi = await import('@alicloud/dypnsapi20170525');
  const { Config } = await import('@alicloud/openapi-client');
  const mod = Dypnsapi as any;
  const Client = mod.Client || (typeof mod.default === 'function' ? mod.default : mod.default?.Client || mod.default?.default);
  return { mod, client: new Client(new Config({ accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID, accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET, endpoint: 'dypnsapi.aliyuncs.com', regionId: 'cn-hangzhou' })) };
}
export const cloudVerification: VerificationProvider = {
  async sendEmail(to, code, purpose) {
    configured(['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'TENCENT_SES_FROM_EMAIL', 'TENCENT_SES_TEMPLATE_ID']);
    const { ses } = await import('tencentcloud-sdk-nodejs-ses');
    const client = new ses.v20201002.Client({ credential: { secretId: process.env.TENCENTCLOUD_SECRET_ID!, secretKey: process.env.TENCENTCLOUD_SECRET_KEY! }, region: process.env.TENCENT_SES_REGION || 'ap-guangzhou', profile: { httpProfile: { reqTimeout: 8 } } });
    await client.SendEmail({ FromEmailAddress: process.env.TENCENT_SES_FROM_EMAIL!, Subject: '道德经共读 · 验证码', Destination: [to], Template: { TemplateID: Number(process.env.TENCENT_SES_TEMPLATE_ID), TemplateData: JSON.stringify({ code, purpose: purpose === 'RESET' ? '密码重置' : purpose === 'RECOVERY' ? '恢复邮箱验证' : '账号注册' }) }, TriggerType: 1 });
  },
  async sendPhone(phoneNumber, outId) {
    const { mod, client } = await phoneClient();
    const result = await client.sendSmsVerifyCodeWithOptions(new mod.SendSmsVerifyCodeRequest({ countryCode: '86', phoneNumber, outId, schemeName: process.env.ALIBABA_PNVS_SCHEME_NAME, signName: process.env.ALIBABA_PNVS_SIGN_NAME, templateCode: process.env.ALIBABA_PNVS_TEMPLATE_CODE, templateParam: JSON.stringify({ code: '##code##', min: '5' }), codeLength: 6, codeType: 1, validTime: 300, interval: 60, duplicatePolicy: 1 }), {});
    if (result.body?.success === false || (result.body?.code && result.body.code !== 'OK')) throw new ApiError(502, '短信发送失败，请稍后重试');
  },
  async checkPhone(phoneNumber, verifyCode, outId) {
    const { mod, client } = await phoneClient();
    try {
      const result = await client.checkSmsVerifyCodeWithOptions(new mod.CheckSmsVerifyCodeRequest({ countryCode: '86', phoneNumber, verifyCode, outId, schemeName: process.env.ALIBABA_PNVS_SCHEME_NAME }), {});
      return result.body?.success === true && result.body?.model?.verifyResult === 'PASS';
    } catch { return false; }
  },
};
export function generateEmailCode() { return String(crypto.randomInt(100000, 1000000)); }
