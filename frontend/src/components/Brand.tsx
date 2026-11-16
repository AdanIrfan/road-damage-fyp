/**
 * Product mark and working name. "RoadWatch" is a temporary product name (not final);
 * change it here only. The official project title is unchanged.
 */
export const PRODUCT_NAME = "RoadWatch";
export const PRODUCT_TAGLINE = "Road maintenance";

/** Two road-marking dashes on an ink tile. */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#16263d" />
      <rect x="14" y="7" width="4" height="7" rx="1" fill="#f5c518" />
      <rect x="14" y="18" width="4" height="7" rx="1" fill="#f5c518" />
    </svg>
  );
}

export function Brand({ onDark = false, showTagline = true }: { onDark?: boolean; showTagline?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="flex flex-col leading-tight">
        <span className={`text-[15px] font-bold tracking-wide ${onDark ? "text-white" : "text-ink-900"}`}>{PRODUCT_NAME}</span>
        {showTagline && <span className={`text-[11px] ${onDark ? "text-ink-on-dark" : "text-ink-500"}`}>{PRODUCT_TAGLINE}</span>}
      </span>
    </span>
  );
}
