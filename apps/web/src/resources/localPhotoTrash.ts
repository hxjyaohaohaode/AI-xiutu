import type { EditorRecipe } from '@ai-xiutu/editor';
import { PHOTO_TRASH_MS } from '@ai-xiutu/contracts';
import { secureUuid } from '../lib/uuid';

const storeName = 'photos';
const databaseName = 'studio-photo-trash';

export interface LocalPhotoTrashEntry {
  id: string;
  owner: string;
  file: File;
  recipe: EditorRecipe;
  layerFiles: [string, File][];
  expiresAt: number;
}

function openTrash() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const photos = request.result.createObjectStore(storeName, { keyPath: 'id' });
      photos.createIndex('owner', 'owner');
      photos.createIndex('expiresAt', 'expiresAt');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function accessTrash<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openTrash();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
      operation(tx.objectStore(storeName), (next) => { value = next; });
    });
  } finally {
    db.close();
  }
}

export function storeLocalPhoto(
  owner: string,
  file: File,
  recipe: EditorRecipe,
  layerFiles: ReadonlyMap<string, File>,
) {
  const id = secureUuid();
  return accessTrash<void>('readwrite', (photos) => {
    photos.add({ id, owner, file, recipe, layerFiles: [...layerFiles], expiresAt: Date.now() + PHOTO_TRASH_MS });
  });
}

export function pruneLocalPhotoTrash(now = Date.now()) {
  return accessTrash<void>('readwrite', (photos) => {
    const cursor = photos.index('expiresAt').openKeyCursor(IDBKeyRange.upperBound(now));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      photos.delete(item.primaryKey);
      item.continue();
    };
  });
}

export async function listLocalPhotoTrash(owner: string) {
  await pruneLocalPhotoTrash();
  return accessTrash<LocalPhotoTrashEntry[]>('readonly', (photos, result) => {
    const request = photos.index('owner').getAll(owner);
    request.onsuccess = () => result(request.result
      .filter((item: LocalPhotoTrashEntry) => item.expiresAt > Date.now())
      .sort((a, b) => b.expiresAt - a.expiresAt));
  });
}

export function removeLocalPhoto(owner: string, id: string) {
  return accessTrash<void>('readwrite', (photos) => {
    const request = photos.get(id);
    request.onsuccess = () => {
      if (request.result?.owner === owner) photos.delete(id);
    };
  });
}
