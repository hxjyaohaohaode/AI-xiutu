import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/** Files are flushed separately by callers. Node cannot flush directory handles
 * on Windows. Local development may use file flushes; production must retain the
 * stronger directory durability contract and fails before publishing a result. */
export async function syncStorageDirectory(path: string): Promise<void> {
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error('STORAGE_DIRECTORY_INVALID');
  if (process.platform === 'win32') {
    if (process.env.NODE_ENV === 'production')
      throw new Error('STORAGE_DIRECTORY_DURABILITY_UNSUPPORTED');
    return;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
