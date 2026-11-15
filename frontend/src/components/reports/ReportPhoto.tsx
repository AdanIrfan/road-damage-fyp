import { useEffect, useState } from "react";
import { Spinner } from "../ui";
import { apiBlob, errorMessage } from "../../lib/api";
import { damageClassLabel, formatConfidence } from "./labels";
import type { Detection, ReportImage } from "../../lib/reportTypes";

/**
 * A report photo loaded through the authorised API (never a public URL), with the AI's
 * bounding boxes drawn on top. Boxes are in pixels of the stored image, so they are converted
 * to percentages and stay aligned at any display size.
 */
export function ReportPhoto({ image, detections = [], className = "" }: { image: ReportImage; detections?: Detection[]; className?: string }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    setSrc(undefined);
    setError(undefined);
    apiBlob(image.url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [image.url]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg bg-slate-100 ${className}`}
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
    >
      {src === undefined ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          {error ?? <Spinner className="size-6 text-blue-600" />}
        </div>
      ) : (
        <img src={src} alt="Reported road damage" className="absolute inset-0 h-full w-full object-contain" />
      )}
      {src !== undefined &&
        detections.map((d) => (
          <div
            key={d.id}
            className="pointer-events-none absolute border-2 border-amber-400"
            style={{
              left: `${(d.box.x1 / image.width) * 100}%`,
              top: `${(d.box.y1 / image.height) * 100}%`,
              width: `${((d.box.x2 - d.box.x1) / image.width) * 100}%`,
              height: `${((d.box.y2 - d.box.y1) / image.height) * 100}%`,
            }}
          >
            <span className="absolute -top-0.5 left-0 -translate-y-full whitespace-nowrap rounded-sm bg-amber-400 px-1 text-[11px] font-semibold text-slate-900">
              {damageClassLabel(d.className)} {formatConfidence(d.confidence)}
            </span>
          </div>
        ))}
    </div>
  );
}
