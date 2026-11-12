export async function inflateMasterBlock(bytes: Uint8Array, size: number) {
  const reader = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const decoded = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) throw new Error('Master tile exceeds its bounds');
      decoded.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== size) throw new Error('Master tile ended early');
    return decoded;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
