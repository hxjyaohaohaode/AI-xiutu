import { open, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

type File = Awaited<ReturnType<typeof open>>;
async function readExactly(file: File, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error('Generated image metadata is truncated');
    offset += bytesRead;
  }
}
async function writeExactly(file: File, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten === 0) throw new Error('Generated image metadata write stopped');
    offset += bytesWritten;
  }
}

/** Read the bundled, known sRGB profile from a one-pixel tagged output. No user ICC paths. */
export async function srgbProfile(): Promise<Buffer> {
  const tagged = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#808080' },
  })
    .withIccProfile('srgb')
    .png()
    .toBuffer();
  const profile = (await sharp(tagged).metadata()).icc;
  if (!profile || profile.length > 1_048_576) throw new Error('Bundled sRGB profile unavailable');
  return profile;
}
/** Add a profile without transforming samples a second time. Restricted to our own single-page classic TIFF outputs. */
export async function attachTiffIcc(path: string, profile: Buffer): Promise<void> {
  if (profile.length < 128 || profile.length > 1_048_576)
    throw new Error('ICC profile size invalid');
  const file = await open(path, 'r+');
  try {
    const stat = await file.stat(),
      header = Buffer.alloc(8);
    await readExactly(file, header, 0);
    const little = header.toString('ascii', 0, 2) === 'II';
    if (!little && header.toString('ascii', 0, 2) !== 'MM')
      throw new Error('Invalid TIFF byte order');
    const u16 = (b: Buffer, offset: number) =>
        little ? b.readUInt16LE(offset) : b.readUInt16BE(offset),
      u32 = (b: Buffer, offset: number) =>
        little ? b.readUInt32LE(offset) : b.readUInt32BE(offset),
      w16 = (b: Buffer, value: number, offset: number) =>
        little ? b.writeUInt16LE(value, offset) : b.writeUInt16BE(value, offset),
      w32 = (b: Buffer, value: number, offset: number) =>
        little ? b.writeUInt32LE(value, offset) : b.writeUInt32BE(value, offset);
    if (u16(header, 2) !== 42)
      throw new Error('ICC attachment only supports bounded classic TIFF masters');
    const offset = u32(header, 4),
      countBuffer = Buffer.alloc(2);
    if (offset + 2 > stat.size) throw new Error('TIFF directory out of bounds');
    await readExactly(file, countBuffer, offset);
    const count = u16(countBuffer, 0);
    if (count > 1024 || offset + 2 + count * 12 + 4 > stat.size)
      throw new Error('TIFF directory exceeds budget');
    const old = Buffer.alloc(count * 12 + 4);
    await readExactly(file, old, offset + 2);
    if (u32(old, count * 12) !== 0) throw new Error('Only single-page TIFF masters can be tagged');
    const entries: Buffer[] = [];
    for (let i = 0; i < count; i++)
      if (u16(old, i * 12) !== 34675) entries.push(Buffer.from(old.subarray(i * 12, i * 12 + 12)));
    const profileOffset = Math.ceil(stat.size / 4) * 4,
      directoryOffset = Math.ceil((profileOffset + profile.length) / 4) * 4;
    if (directoryOffset + 2 + (entries.length + 1) * 12 + 4 > 2_147_483_648)
      throw new Error('Master exceeds file size budget');
    const entry = Buffer.alloc(12);
    w16(entry, 34675, 0);
    w16(entry, 7, 2);
    w32(entry, profile.length, 4);
    w32(entry, profileOffset, 8);
    entries.push(entry);
    entries.sort((a, b) => u16(a, 0) - u16(b, 0));
    const directory = Buffer.alloc(2 + entries.length * 12 + 4);
    w16(directory, entries.length, 0);
    entries.forEach((e, i) => e.copy(directory, 2 + i * 12));
    await writeExactly(file, profile, profileOffset);
    await writeExactly(file, directory, directoryOffset);
    w32(header, directoryOffset, 4);
    await writeExactly(file, header, 0);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Streaming PNG metadata insertion; output pixels and compressed IDAT bytes remain untouched. */
export async function attachPngIcc(path: string, profile: Buffer): Promise<void> {
  if (profile.length < 128 || profile.length > 1_048_576)
    throw new Error('ICC profile size invalid');
  const source = await open(path, 'r'),
    temp = `${path}.icc`;
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const header = Buffer.alloc(33);
    await readExactly(source, header, 0);
    if (
      !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      header.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('Invalid generated PNG header');
    const data = Buffer.concat([Buffer.from('embedded\0\0', 'binary'), deflateSync(profile)]),
      chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write('iCCP', 4, 'ascii');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
    destination = await open(temp, 'wx', 0o600);
    await destination.writeFile(header);
    await destination.writeFile(chunk);
    let offset = 33;
    for (;;) {
      const h = Buffer.alloc(8);
      await readExactly(source, h, offset);
      const length = h.readUInt32BE(0),
        type = h.toString('ascii', 4, 8);
      if (type === 'IDAT' || type === 'IEND') break;
      if (length > 1_048_576 || offset + length + 12 > 2_097_152)
        throw new Error('Generated PNG metadata exceeds budget');
      if (!['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(type)) {
        const body = Buffer.alloc(length + 12);
        await readExactly(source, body, offset);
        await destination.writeFile(body);
      }
      offset += length + 12;
    }
    for await (const part of createReadStream(path, { start: offset, highWaterMark: 262_144 }))
      await destination.writeFile(part as Buffer);
    await destination.sync();
    await destination.close();
    destination = undefined;
    await rename(temp, path);
  } finally {
    await source.close();
    await destination?.close();
    await rm(temp, { force: true });
  }
}
