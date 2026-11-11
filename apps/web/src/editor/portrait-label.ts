import type { PortraitAnalysis, PortraitTarget } from '@ai-xiutu/portrait';
import { t } from '../i18n';

/** Localize the known generated label only at presentation; stored names stay verbatim. */
export function portraitTargetDisplayLabel(
  target: PortraitTarget,
  analysis: PortraitAnalysis | null,
): string {
  if (analysis?.provider !== 'mediapipe' || analysis.algorithmVersion !== 'mediapipe-v1-selfie256')
    return target.label;
  const generated = /^(face|body)-([a-f0-9]{12})-([1-8])$/.exec(target.id);
  if (
    !generated ||
    generated[1] !== target.kind ||
    generated[2] !== analysis.frame.contentHash.slice(0, 12)
  )
    return target.label;
  const number = generated[3]!;
  const expected = `${target.kind === 'face' ? '人物' : '身形'} ${number}`;
  if (target.label !== expected) return target.label;
  return target.kind === 'face' ? t('人物 {number}', { number }) : t('身形 {number}', { number });
}
