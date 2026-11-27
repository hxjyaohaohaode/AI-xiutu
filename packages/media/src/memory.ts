import { readFile } from 'node:fs/promises';
import { MediaProcessingError } from './types.js';

export const MiB = 1024 ** 2;
const limit = (message: string) => new MediaProcessingError(message, 'memory');

// A running container can reclaim inactive file cache from its staged TIFFs.
export function cgroupHeadroom(max: string, usage: string, stat: string, legacy: boolean) {
  const cap = Number(max),
    used = Number(usage);
  if (!Number.isSafeInteger(cap) || cap <= 0 || !Number.isSafeInteger(used) || used < 0)
    return undefined;
  const inactive = Number(
    stat.match(legacy ? /^total_inactive_file (\d+)$/m : /^inactive_file (\d+)$/m)?.[1] ?? 0,
  );
  return { cap, free: Math.max(0, cap - used + Math.min(used, inactive)) };
}

async function dockerCgroup(legacy: boolean) {
  const dir = legacy ? '/sys/fs/cgroup/memory/' : '/sys/fs/cgroup/';
  const [limitFile, usageFile] = legacy
    ? ['memory.limit_in_bytes', 'memory.usage_in_bytes']
    : ['memory.max', 'memory.current'];
  try {
    const [max, used, stat] = await Promise.all([
      readFile(dir + limitFile, 'utf8'),
      readFile(dir + usageFile, 'utf8'),
      readFile(dir + 'memory.stat', 'utf8'),
    ]);
    return cgroupHeadroom(max, used, stat, legacy);
  } catch {
    return undefined;
  }
}

export async function freeMediaMemory() {
  const [v2, v1, meminfo] = await Promise.all([
    dockerCgroup(false),
    dockerCgroup(true),
    readFile('/proc/meminfo', 'utf8').catch(() => ''),
  ]);
  const host = Number(meminfo.match(/^MemAvailable:\s+(\d+) kB/m)?.[1] ?? Infinity) * 1024;
  const mountedLimit = Math.min(v2?.cap ?? Infinity, v1?.cap ?? Infinity);
  const processLimit = process.constrainedMemory();
  // When the visible mount is an ancestor, libuv resolves the process's own
  // membership. Use the tighter nested allowance rather than the mount root.
  const useLibuv =
    !Number.isFinite(mountedLimit) || (processLimit > 0 && processLimit < mountedLimit);
  return Math.min(
    host,
    v2?.free ?? Infinity,
    v1?.free ?? Infinity,
    useLibuv ? process.availableMemory() : Infinity,
  );
}

export async function residentBudget(ceiling?: number) {
  const free = await freeMediaMemory();
  const reserve = Math.max(64 * MiB, Math.min(256 * MiB, free / 8));
  const budget = Math.floor(Math.min(ceiling ?? Infinity, free - reserve));
  if (budget < 128 * MiB)
    throw limit('Insufficient resident memory to start an isolated media operation');
  return budget;
}

export function requireResident(
  budget: number,
  fixedMiB: number,
  pixels: number,
  bytesPerPixel: number,
) {
  if (fixedMiB * MiB + pixels * bytesPerPixel > budget)
    throw limit('This media operation exceeds currently available resident memory');
}
