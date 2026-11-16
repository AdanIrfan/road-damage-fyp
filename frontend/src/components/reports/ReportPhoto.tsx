import { Eye, EyeOff, ImageOff, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProtectedImage } from "../../lib/protectedImage";
import type { Detection, ReportImage } from "../../lib/reportTypes";
import { Spinner } from "../ui";
import { damageClassLabel, formatConfidence } from "./labels";

/**
 * One colour per damage class, chosen to stay visible on road photos and to differ in lightness
 * as well as hue. Class names come from the model; a class not listed here (for example after a
 * model change) gets a neutral white box instead of being hidden.
 */
const CLASS_COLORS: Record<string, string> = {
  pothole: "#f5c518",
  longitudinal_crack: "#7dd3fc",
  transverse_crack: "#fb923c",
  alligator_crack: "#f0abfc",
};

export function detectionColor(className: string): string {
  return CLASS_COLORS[className] ?? "#ffffff";
}

function Boxes({ image, detections }: { image: ReportImage; detections: Detection[] }) {
  return (
    <>
      {detections.map((d) => {
        const color = detectionColor(d.className);
        // A label above a box at the very top of the photo would be cut off: put it inside instead.
        const labelInside = d.box.y1 / image.height < 0.08;
        return (
          <div
            key={d.id}
            className="pointer-events-none absolute border-[3px]"
            style={{
              borderColor: color,
              left: `${(d.box.x1 / image.width) * 100}%`,
              top: `${(d.box.y1 / image.height) * 100}%`,
              width: `${((d.box.x2 - d.box.x1) / image.width) * 100}%`,
              height: `${((d.box.y2 - d.box.y1) / image.height) * 100}%`,
            }}
          >
            <span
              className={`absolute -left-[3px] px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-ink-900 ${labelInside ? "top-0" : "-top-[3px] -translate-y-full"}`}
              style={{ backgroundColor: color }}
            >
              {damageClassLabel(d.className)} {formatConfidence(d.confidence)}
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * A report or repair photo loaded through the authorised API, with the AI's bounding boxes drawn
 * on top. Boxes are in pixels of the stored image, so they are converted to percentages and stay
 * aligned at any display size. With detections the viewer offers show/hide; every photo can be
 * enlarged.
 */
export function ReportPhoto({
  image,
  detections = [],
  className = "",
  alt = "Reported road damage",
}: {
  image: ReportImage;
  detections?: Detection[];
  className?: string;
  alt?: string;
}) {
  const { src, error } = useProtectedImage(image.url);
  const [showBoxes, setShowBoxes] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const hasDetections = detections.length > 0;

  return (
    <div className={className}>
      <div className="relative w-full overflow-hidden rounded-lg bg-ink-100" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
        {src === undefined ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-ink-500">
            {error !== undefined ? (
              <>
                <ImageOff className="size-6" aria-hidden="true" />
                {error}
              </>
            ) : (
              <>
                <Spinner className="size-6 text-cobalt-600" />
                <span className="sr-only">Loading photo</span>
              </>
            )}
          </div>
        ) : (
          <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-contain" />
        )}
        {src !== undefined && showBoxes && <Boxes image={image} detections={detections} />}
        {src !== undefined && (
          <div className="absolute right-2 bottom-2 flex gap-1.5">
            {hasDetections && (
              <button
                type="button"
                aria-pressed={showBoxes}
                onClick={() => setShowBoxes((value) => !value)}
                className="flex min-h-9 items-center gap-1.5 rounded-lg bg-ink-900/85 px-2.5 text-xs font-semibold text-white hover:bg-ink-900"
              >
                {showBoxes ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                {showBoxes ? "Hide detections" : "Show detections"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Enlarge photo"
              className="flex size-9 items-center justify-center rounded-lg bg-ink-900/85 text-white hover:bg-ink-900"
            >
              <Maximize2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {zoomed && src !== undefined && (
        <Lightbox src={src} alt={alt} image={image} detections={showBoxes ? detections : []} onClose={() => setZoomed(false)} />
      )}
    </div>
  );
}

/** Full-screen view of one photo. Escape, the close button or the backdrop close it. */
function Lightbox({ src, alt, image, detections, onClose }: { src: string; alt: string; image: ReportImage; detections: Detection[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Enlarged photo" className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink-950/90 p-3" onMouseDown={onClose}>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close enlarged photo"
        className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      <div
        className="relative"
        style={{ aspectRatio: `${image.width} / ${image.height}`, width: `min(96vw, calc(88vh * ${image.width / image.height}))` }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-contain" />
        <Boxes image={image} detections={detections} />
      </div>
    </div>
  );
}

/**
 * Small square preview for lists and cards. The photo is only downloaded once the thumbnail is
 * near the visible area, so a long list does not fetch every picture at once.
 */
export function ReportThumb({ image, className = "size-12" }: { image: ReportImage | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  const { src } = useProtectedImage(image?.url ?? "", image !== null && visible);
  return (
    <span ref={ref} aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-150 text-ink-400 ${className}`}>
      {image !== null && src !== undefined ? <img src={src} alt="" className="h-full w-full object-cover" /> : image === null ? <ImageOff className="size-4" /> : null}
    </span>
  );
}
