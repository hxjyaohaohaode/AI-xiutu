import { createContext } from 'react';

/**
 * Resolves embedded project images. Signed-in editors use the private asset
 * routes; the public share viewer swaps in the link-scoped image route.
 */
export const OfficeAssetUrl = createContext<((assetId: string) => string) | null>(null);
