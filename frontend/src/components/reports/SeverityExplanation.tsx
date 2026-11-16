import { classWeight, SEVERITY_EXPLAINER } from "../../lib/severityConfig";
import type { AiAnalysisStatus, Detection, SeverityLevel } from "../../lib/reportTypes";
import { damageClassLabel, formatConfidence, severityLabel } from "./labels";
import { detectionColor } from "./ReportPhoto";

/** The scale is drawn up to this score so both thresholds are visible; higher scores fill it. */
const SCALE_MAX = 0.2;
/** Largest difference between the stored score and the re-added parts that is only rounding. */
const TOLERANCE = 0.0015;

const pct = (value: number) => `${Math.min(100, Math.max(0, (value / SCALE_MAX) * 100))}%`;

/**
 * Explains the stored severity estimate: the score, where it sits against the two thresholds, and
 * what each detection contributed (image share x confidence x class weight).
 *
 * Nothing is invented here. The score and the detections come from the backend; the breakdown is
 * only shown when its parts add up to the stored score. The whole thing is labelled an estimate.
 */
export function SeverityExplanation({
  status,
  level,
  score,
  detections,
  audience = "admin",
}: {
  status: AiAnalysisStatus;
  /** The automatic estimate (never the admin's correction). */
  level: SeverityLevel | null;
  score: number | null;
  detections: Detection[];
  audience?: "admin" | "citizen";
}) {
  if (status === "FAILED") {
    return <p className="text-sm text-ink-600">No estimate: the automatic analysis was not available for this report.</p>;
  }
  if (level === null || score === null) {
    return (
      <p className="text-sm text-ink-600">
        No estimate: no damage was detected automatically.{audience === "citizen" ? " This does not mean there is no damage; an administrator looks at every photo." : ""}
      </p>
    );
  }

  const parts = detections.map((d) => ({ detection: d, weight: classWeight(d.className), part: d.areaFraction * d.confidence * classWeight(d.className) }));
  const total = parts.reduce((sum, p) => sum + p.part, 0);
  const consistent = Math.abs(total - score) <= TOLERANCE;
  const { medium, high } = SEVERITY_EXPLAINER.thresholds;
  const fill = level === "HIGH" ? "bg-sev-high" : level === "MEDIUM" ? "bg-sev-medium" : "bg-sev-low";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-2xl font-medium text-ink-900">{score.toFixed(3)}</span>
        <span className="text-[13px] text-ink-500">score, which gives an estimate of {severityLabel[level].toLowerCase()}</span>
      </div>

      <div>
        <div
          role="img"
          aria-label={`Score ${score.toFixed(3)}. Medium starts at ${medium}, high starts at ${high}.`}
          className="relative mt-1 h-2.5 rounded-full bg-ink-150"
        >
          <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: pct(score) }} />
          <div className="absolute -top-1 h-[18px] w-0.5 bg-ink-900" style={{ left: pct(medium) }} />
          <div className="absolute -top-1 h-[18px] w-0.5 bg-ink-900" style={{ left: pct(high) }} />
        </div>
        <div className="relative mt-1.5 h-4 font-mono text-[11px] text-ink-500" aria-hidden="true">
          <span className="absolute left-0">Low</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(medium) }}>
            {medium} Medium
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(high) }}>
            {high} High
          </span>
        </div>
      </div>

      {consistent ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wider text-ink-500 uppercase">
                <th className="py-1.5 pr-2 font-semibold">Detection</th>
                <th className="px-2 py-1.5 text-right font-semibold">Share</th>
                <th className="px-2 py-1.5 text-right font-semibold">Conf.</th>
                <th className="px-2 py-1.5 text-right font-semibold">Weight</th>
                <th className="py-1.5 pl-2 text-right font-semibold">Part</th>
              </tr>
            </thead>
            <tbody>
              {parts.map(({ detection, weight, part }) => (
                <tr key={detection.id} className="border-t border-ink-100">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-2 font-medium text-ink-900">
                      <span className="size-3 shrink-0 border-[3px] border-ink-900" style={{ backgroundColor: detectionColor(detection.className) }} aria-hidden="true" />
                      {damageClassLabel(detection.className)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{(detection.areaFraction * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatConfidence(detection.confidence)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{weight.toFixed(1)}</td>
                  <td className="py-1.5 pl-2 text-right font-mono">{part.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-500">The per-detection breakdown is not shown because the scoring settings have changed since this report was analysed.</p>
      )}

      <p className="text-xs text-ink-500">
        Each detection adds its share of the photo × confidence × a class weight (pothole 1.0, alligator crack 0.8, longitudinal and transverse crack
        0.5). This is an automatic estimate from one photo, not an engineering measurement
        {audience === "citizen" ? "; an administrator reviews every report." : "."}
      </p>
    </div>
  );
}
