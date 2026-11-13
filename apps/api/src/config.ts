import { resolve } from 'node:path';
export interface AppConfig {
  databaseUrl: string;
  sessionSecret: string;
  origins: string[];
  port: number;
  host: string;
  storageDir: string;
  secureCookie: boolean;
  maxUploadBytes: number;
  maxPixels: number;
  trustProxyHops?: number;
  supportQrFile?: string;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new Error('SESSION_SECRET must have at least 32 random characters');
  const origins = (env.APP_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('APP_ORIGIN must contain exact origins without paths');
  }
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} is out of bounds`);
    return n;
  };
  return {
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    origins,
    port: bounded('PORT', 3001, 1, 65535),
    host: env.HOST ?? '127.0.0.1',
    storageDir: resolve(env.STORAGE_DIR ?? '.data/private'),
    secureCookie: env.COOKIE_SECURE === 'true' || origins.every((o) => o.startsWith('https://')),
    maxUploadBytes: bounded('MAX_UPLOAD_BYTES', 20 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    maxPixels: bounded('MAX_IMAGE_PIXELS', 40_000_000, 1, 64_000_000),
    trustProxyHops: bounded('TRUST_PROXY_HOPS', 0, 0, 1),
    supportQrFile: env.SUPPORT_QR_FILE?.trim() ? resolve(env.SUPPORT_QR_FILE.trim()) : undefined,
  };
}
