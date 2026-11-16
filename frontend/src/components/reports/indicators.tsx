import type { RepairStatus, ReportStatus, SeverityLevel } from "../../lib/reportTypes";
import { repairStatusLabel, reportStatusLabel, severityLabel } from "./labels";

/**
 * Three deliberately different looks, so a row never shows identical pills:
 *   report status  -> neutral pill with a coloured dot
 *   severity       -> 1 to 3 bars plus a label (never colour alone)
 *   repair status  -> outlined or solid ink pill
 */

const STATUS_DOT: Record<ReportStatus, string> = {
  SUBMITTED: "bg-cobalt-600",
  UNDER_REVIEW: "bg-[#6d4ad6]",
  ACCEPTED: "bg-[#0e7490]",
  DELAYED: "bg-ink-400",
  REJECTED: "bg-danger-700",
  COMPLETED: "bg-sev-low",
};

export function StatusPill({ status }: { status: ReportStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap text-ink-900">
      <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
      {reportStatusLabel[status]}
    </span>
  );
}

const SEVERITY_BARS: Record<SeverityLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const SEVERITY_FILL: Record<SeverityLevel, string> = { LOW: "bg-sev-low", MEDIUM: "bg-sev-medium", HIGH: "bg-sev-high" };

/**
 * `estimated` marks a value that comes from the automatic heuristic (not corrected by an admin).
 * `level === null` means no severity exists (no detections, or the analysis failed).
 */
export function SeverityIndicator({ level, estimated = false, size = "md" }: { level: SeverityLevel | null; estimated?: boolean; size?: "md" | "lg" }) {
  const filled = level === null ? 0 : SEVERITY_BARS[level];
  const heights = size === "lg" ? ["h-2", "h-3.5", "h-[18px]"] : ["h-1.5", "h-2.5", "h-3.5"];
  return (
    <span className="inline-flex items-end gap-2 whitespace-nowrap">
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        {heights.map((height, index) => (
          <span key={height} className={`${size === "lg" ? "w-[5px]" : "w-1"} rounded-[1px] ${height} ${level !== null && index < filled ? SEVERITY_FILL[level] : "bg-ink-200"}`} />
        ))}
      </span>
      <span className={`leading-none font-semibold ${size === "lg" ? "text-base" : "text-[13px]"} ${level === null ? "text-ink-500" : "text-ink-900"}`}>
        {level === null ? "Not estimated" : estimated ? `Estimated ${severityLabel[level].toLowerCase()}` : severityLabel[level]}
      </span>
    </span>
  );
}

export function RepairPill({ status, attempt }: { status: RepairStatus; attempt?: number | null }) {
  const style = status === "WORKING" ? "bg-ink-900 text-white border-ink-900" : status === "COMPLETED" ? "border-sev-low text-success-800" : "border-ink-400 text-ink-900";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${style}`}>
      {repairStatusLabel[status]}
      {attempt !== undefined && attempt !== null && attempt > 1 ? ` · attempt ${attempt}` : ""}
    </span>
  );
}

/**
 * Short display reference for a report, e.g. "RD-7F3A2C". Derived from the report's UUID for
 * people to read and quote. It is NOT an identifier: links, API calls and authorization always
 * use the full UUID.
 */
export function reportRef(id: string): string {
  return `RD-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export function ReportRef({ id, className = "" }: { id: string; className?: string }) {
  return <span className={`font-mono text-xs text-ink-500 ${className}`}>{reportRef(id)}</span>;
}
