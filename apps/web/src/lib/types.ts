import type { EditorRecipe } from '@ai-xiutu/editor';
import type { RevisionOriginKind, AssetSource } from '@ai-xiutu/contracts';

export type User = {
  id: string;
  displayName: string;
  phoneMasked: string;
  isOperator: boolean;
  status: string;
};
export type Space = { id: string; name: string; kind: 'personal' | 'team'; role: string };
export type Session = { user: User | null; spaces: Space[] };
export type SupportCatalog = {
  qrUrl: '/v1/support/wechat-qr' | null;
  phoneVerified: boolean;
  rates: {
    asOf: string;
    cnyPerUsd: number;
    model: string;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    inputShare: number;
  };
  tiers: { cents: number; points: number; usd: number; textTokens: number }[];
};
export type PublicConfig = {
  brand: { name: string; tagline: string; logoAssetId?: string | null; logoUrl?: string | null };
  capabilities: {
    smsConfigured: boolean;
    aiConfigured: boolean;
    providerConfigured?: boolean;
    moderationConfigured: boolean;
    paymentConfigured: boolean;
    aiUnavailableReason?: string;
    availableOperations?: string[];
  };
  quota: { period: string; freeUnits: number };
  limits: { maxUploadBytes: number; maxPixels: number };
  media?: {
    serverImport: string[];
    canonical: string;
    maxPixels: number;
    maxDimension: number;
    maxUploadBytes: number;
    maxCanonicalBytes: number;
  };
  registrationMode?: 'open' | 'invite';
};
export type Project = {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  role: string;
};
export type Asset = {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
  thumbnailUrl?: string;
  source?: AssetSource;
  createdAt?: string;
  annotations?: {
    title: string | null;
    tags: string[];
    capturedAt: string | null;
    location: { label: string } | null;
  };
  annotationVersion?: number;
  annotationUpdatedAt?: string;
  provenance?: { kind?: string; [key: string]: unknown };
};
export type Artwork = {
  id: string;
  projectId: string;
  assetId: string;
  title: string;
  headVersion: number;
  headRevisionId?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type Revision = {
  id: string;
  artworkId: string;
  assetId: string;
  version: number;
  recipe: EditorRecipe;
  label?: string;
  createdAt: string;
  parentId?: string | null;
  authorId?: string;
  origin?: { kind: RevisionOriginKind; sourceRevisionId: string | null };
};
export type RevisionSummary = Omit<Revision, 'recipe'>;
export type View = 'editor' | 'works' | 'collaborate' | 'docs' | 'usage';
export type Notice = { message: string; tone: 'success' | 'error' | 'info' };
export type Comment = {
  id: string;
  body: string;
  bodyVersion: number;
  editedAt?: string | null;
  anchor?: { x: number; y: number; shape?: 'point' | 'diamond' | 'frame' } | null;
  artworkId?: string;
  revisionId?: string;
  createdAt: string;
  authorName?: string;
  authorId?: string;
  resolved: boolean;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done';
  version: number;
  artworkId?: string;
  revisionId?: string;
  createdAt: string;
};
export type ProjectDocument = {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
};
