import type { SourceFrame } from '@ai-xiutu/contracts';
import type { Point, SelectionMaskV3 } from '@ai-xiutu/editor';

export const REFINED_PORTRAIT_ANALYSIS = 'mediapipe-v2-face-roi';
export const PRECISE_PORTRAIT_ANALYSIS = 'mediapipe-v3-part-evidence';

/** Detection is geometric analysis, never identity recognition or a beauty score. */
export interface PortraitTarget {
  id: string;
  kind: 'face' | 'body';
  label: string;
  landmarks: (Point & { z?: number; visibility?: number })[];
  contours: Record<string, Point[]>;
  bounds: { x: number; y: number; width: number; height: number };
  featureMasks?: {
    skin?: SelectionMaskV3;
    teeth?: SelectionMaskV3;
    nostrils?: SelectionMaskV3;
    accessories?: SelectionMaskV3;
    relight?: { light: SelectionMaskV3; shade: SelectionMaskV3 };
  };
  /** Local per-person pose segmentation; absent when the outline is unreliable. */
  bodyMask?: SelectionMaskV3;
  /** Soft edit corridor around the observed outline, before protecting neighbors. */
  bodySupport?: SelectionMaskV3;
}
export interface PortraitAnalysis {
  schemaVersion: 1;
  provider: string;
  algorithmVersion: string;
  frame: SourceFrame;
  targets: PortraitTarget[];
  segmentation: {
    skin: SelectionMaskV3;
    hair: SelectionMaskV3;
    background: SelectionMaskV3;
    subject?: SelectionMaskV3;
  } | null;
  warnings: string[];
}
export interface PortraitTool {
  id: string;
  label: string;
  group: 'skin' | 'features' | 'body' | 'makeup';
  target: 'face' | 'body';
  min: number;
  max: number;
  step: number;
  description: string;
  method: 'local-color' | 'landmark-warp' | 'masked-paint';
}
export type PortraitValues = Record<string, number>;
