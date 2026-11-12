/** The original mark is one asset in public, account, loading and studio states. */
export function BrandMark({ className = '', logoUrl }: { className?: string; logoUrl?: string | null }) {
  return <img className={'product-brand-mark ' + className} src={logoUrl || '/brand-mark.svg'} alt="" />;
}
