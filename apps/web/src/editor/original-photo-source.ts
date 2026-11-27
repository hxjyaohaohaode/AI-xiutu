import { PHOTO_MAX_BYTES } from '@ai-xiutu/editor';
import { photoFileDigest } from '../media/upload-photo';
import { t } from '../i18n';

/** The private original endpoint serves a measured Content-Length and checks project membership. */
export async function getOriginalPhoto(file: File | null, assetId: string | null, name: string, signal: AbortSignal, expectedDigest?: string | null) {
  if (file) return file;
  if (!assetId || !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error(t('原件不可用，请重新打开照片。'));
  const response = await fetch('/v1/assets/' + encodeURIComponent(assetId) + '/media/original', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error(t('原件不可用，请重新打开照片。'));
  const length = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length <= 0 || length > PHOTO_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(t('无法核对原件大小，请选择编辑副本尺寸。'));
  }
  const blob = await response.blob();
  if (blob.size !== length) throw new Error(t('无法核对原件大小，请选择编辑副本尺寸。'));
  const original = new File([blob], name);
  if (await photoFileDigest(original, signal) !== expectedDigest)
    throw new Error(t('原件内容与保存记录不一致，请重新打开照片。'));
  return original;
}
