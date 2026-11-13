export const PHOTO_TRASH_HOURS = 48;
export const PHOTO_TRASH_MS = PHOTO_TRASH_HOURS * 60 * 60 * 1000;

export type PhotoTrashKind = 'asset' | 'artwork';

export interface PhotoTrashEntry {
  kind: PhotoTrashKind;
  id: string;
  token: string;
  title: string;
  projectId: string;
  projectTitle: string;
  deletedAt: string;
  expiresAt: string;
}

export interface PhotoTrashPage {
  items: PhotoTrashEntry[];
  nextCursor: string | null;
}
