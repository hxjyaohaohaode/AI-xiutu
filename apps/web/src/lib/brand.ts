/** The only web fallback brand name. The server public configuration takes precedence. */
export const DEFAULT_BRAND = '映间';

export function brandLogoUrl(
  brand?: { logoUrl?: string | null; logoAssetId?: string | null } | null,
) {
  if (!brand?.logoUrl) return null;
  return `${brand.logoUrl}${brand.logoUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(brand.logoAssetId ?? 'default')}`;
}
