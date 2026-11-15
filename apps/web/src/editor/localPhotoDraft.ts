import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';

type DraftSource = { file: File } | {
  projectId: string;
  assetId: string;
  artwork?: { id: string; version: number; revisionId: string };
};

export interface LocalPhotoDraft {
  owner: string;
  key: string;
  source: DraftSource;
  recipe: EditorRecipe;
  layerFiles: [string, File][];
  updatedAt: number;
}

const recipeKey = (owner: string) => `studio:photo-draft:recipe:${owner}`;
const store = 'activePhotos';
let connection: Promise<IDBDatabase> | null = null;

function openDrafts() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('studio-photo-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'owner' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}

async function access<T>(
  mode: IDBTransactionMode,
  run: (photos: IDBObjectStore, done: (value: T) => void) => void,
) {
  const db = await openDrafts();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error);
    run(tx.objectStore(store), (next) => { value = next; });
  });
}

export function writePhotoDraft(value: LocalPhotoDraft) {
  return access<void>('readwrite', (photos) => {
    const previous = photos.get(value.owner);
    previous.onsuccess = () => {
      if (!previous.result || previous.result.updatedAt <= value.updatedAt) photos.put(value);
    };
  });
}

/** A small recipe can commit synchronously as the page is closing. File and layer
 * bytes are in IndexedDB. An unmatched recipe is never applied to another source. */
export function checkpointPhotoRecipe(value: LocalPhotoDraft) {
  try {
    localStorage.setItem(recipeKey(value.owner), JSON.stringify({
      key: value.key, recipe: value.recipe, updatedAt: value.updatedAt,
    }));
  } catch { /* IndexedDB also stores the full recipe. */ }
}

export async function readPhotoDraft(owner: string): Promise<LocalPhotoDraft | undefined> {
  const draft = await access<LocalPhotoDraft | undefined>('readonly', (photos, done) => {
    const request = photos.get(owner);
    request.onsuccess = () => done(request.result);
  });
  if (!draft || draft.owner !== owner) return;
  try {
    const patch = JSON.parse(localStorage.getItem(recipeKey(owner)) ?? 'null');
    if (patch?.key === draft.key && patch.updatedAt >= draft.updatedAt) {
      const recipe = parseEditorRecipe(patch.recipe);
      const layers = new Set(draft.layerFiles.map(([key]) => key));
      if (!('imageLayers' in recipe) || recipe.imageLayers.every(({ sourceId }) =>
        !sourceId.startsWith('local:') || layers.has(sourceId))) return { ...draft, recipe };
    }
  } catch { /* A damaged or unsupported journal leaves the IndexedDB copy intact. */ }
  return draft;
}

export async function removePhotoDraft(owner: string, key: string) {
  await access<void>('readwrite', (photos) => {
    const previous = photos.get(owner);
    previous.onsuccess = () => {
      if (previous.result?.key === key) photos.delete(owner);
    };
  });
  try {
    if (JSON.parse(localStorage.getItem(recipeKey(owner)) ?? 'null')?.key === key)
      localStorage.removeItem(recipeKey(owner));
  } catch { /* The source key is required to recover a journaled recipe. */ }
}
