import { z } from 'zod';

const label = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/);
export const resourceMemorySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    remembered: z.boolean(),
    title: label(200).nullable(),
    tags: z
      .array(label(40))
      .max(30)
      .refine((tags) => new Set(tags).size === tags.length),
    note: z.string().max(2000),
  })
  .strict();
export type ResourceMemoryUpdate = z.infer<typeof resourceMemorySchema>;
export interface ResourceMemory {
  remembered: boolean;
  title: string | null;
  tags: string[];
  note: string;
  version: number;
  updatedAt: string;
}
export interface ResourceSearchItem<Asset = unknown> {
  asset: Asset;
  space: { id: string; name: string; kind: 'personal' | 'team' };
  project: { id: string; title: string };
  memory: ResourceMemory | null;
}
export interface ResourceSearchResponse<Asset = unknown> {
  resources: ResourceSearchItem<Asset>[];
  nextCursor: string | null;
}
export const usageKinds = [
  'issued',
  'held',
  'consumed',
  'released',
  'expired',
  'adjusted',
] as const;
export type UsageKind = (typeof usageKinds)[number];
export type UsageCounters = Record<UsageKind, number>;
export interface UsageEntry {
  id: string;
  kind: UsageKind;
  units: number | null;
  movement: Partial<UsageCounters>;
  spaceId: string;
  actorId: string | null;
  lotId: string | null;
  holdId: string | null;
  jobId: string | null;
  modelId: string | null;
  operation: string | null;
  sourceKind: 'free' | 'gift' | 'purchased' | null;
  createdAt: string;
  reason: string;
  /** Old expiry entries carried zero and no exact quantity. Unknown is never displayed as 0. */
  amountKnown: boolean;
  movementComplete: boolean;
}
export interface UsageResponse {
  unit: 'credit';
  timezone: 'Asia/Shanghai';
  scope: 'personal' | 'space' | 'operator';
  range: { from: string; to: string; bucket: 'day' | 'month' };
  totals: UsageCounters;
  unknownAmountEntries: number;
  series: ({ bucket: string; unknownAmountEntries: number } & UsageCounters)[];
  entries: UsageEntry[];
  nextCursor: string | null;
  /** Snapshot of the same authorized wallet(s), independent from the report's time filter. */
  balance: { available: number; held: number; consumed: number; expired: number; revoked: number };
}
export interface MemberActivity {
  id: string;
  kind: 'joined' | 'role-changed' | 'removed' | 'owner-transferred';
  actorId: string | null;
  actorName: string | null;
  targetUserId: string;
  targetName: string;
  previousRole: string | null;
  role: string | null;
  createdAt: string;
}
