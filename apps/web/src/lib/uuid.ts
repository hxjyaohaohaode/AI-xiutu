/** The subset of Web Crypto used here, injectable for deterministic platform tests. */
export type UuidCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
};

export class SecureRandomUnavailableError extends Error {
  readonly code = 'SECURE_RANDOM_UNAVAILABLE';

  constructor(cause?: unknown) {
    super('当前浏览器缺少安全随机数，暂时无法提交此操作。请使用支持 Web Crypto 的浏览器。', {
      cause,
    });
    this.name = 'SecureRandomUnavailableError';
  }
}

/** Secure UUID v4, including HTTP contexts where randomUUID is not exposed. */
export function secureUuid(source: UuidCrypto | null | undefined = globalThis.crypto): string {
  let nativeFailure: unknown;
  if (typeof source?.randomUUID === 'function') {
    try {
      return source.randomUUID();
    } catch (error) {
      nativeFailure = error;
    }
  }
  if (typeof source?.getRandomValues !== 'function') {
    throw new SecureRandomUnavailableError(nativeFailure);
  }
  const bytes = new Uint8Array(16);
  try {
    source.getRandomValues(bytes);
  } catch (error) {
    throw new SecureRandomUnavailableError(error);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
