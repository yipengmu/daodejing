import dotenv from 'dotenv';
dotenv.config({ quiet: true });
if (process.env.NODE_ENV !== 'production') dotenv.config({ path: '.local/runtime.env', quiet: true });

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public retryAt?: string) { super(message); }
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new ApiError(503, '服务暂未开放，请稍后再试', 'SERVICE_UNCONFIGURED');
  return value;
}
export function secrets() { return { jwt: required('JWT_SECRET'), hmac: required('IDENTITY_HMAC_SECRET') }; }
export const isProduction = () => process.env.NODE_ENV === 'production';
