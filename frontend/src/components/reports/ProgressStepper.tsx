import { Check } from "lucide-react";
import type { ReportStatus } from "../../lib/reportTypes";

/**
 * Where a report is on its way from submission to a confirmed repair.
 * The five steps are fixed; the middle one is named after the actual decision.
 *
 *   Submitted -> Under review -> Accepted | Delayed | Not accepted -> Repair -> Completed
 *
 * `repairActive`: an engineer is assigned (the repair step has begun).
 */
export interface ReportStage {
  /** Index of the current step (0-4). 5 when everything is done. */
  index: number;
  labels: [string, string, string, string, string];
  /** The report ended without a repair (rejected). */
  closed: boolean;
}

export function reportStage(status: ReportStatus, repairActive: boolean): ReportStage {
  const decision = status === "REJECTED" ? "Not accepted" : status === "DELAYED" ? "Delayed" : status === "ACCEPTED" || status === "COMPLETED" ? "Accepted" : "Decision";
  const labels: ReportStage["labels"] = ["Submitted", "Under review", decision, "Repair", "Completed"];
  switch (status) {
    case "SUBMITTED":
      return { index: 0, labels, closed: false };
    case "UNDER_REVIEW":
      return { index: 1, labels, closed: false };
    case "DELAYED":
      return { index: 2, labels, closed: false };
    case "REJECTED":
      return { index: 2, labels, closed: true };
    case "ACCEPTED":
      return { index: repairActive ? 3 : 2, labels, closed: false };
    case "COMPLETED":
      return { index: 5, labels, closed: false };
  }
}

function segmentClass(stage: ReportStage, step: number): string {
  if (step < stage.index) return "bg-ink-900";
  if (step === stage.index) return stage.closed ? "bg-ink-400" : "bg-cobalt-600";
  return "bg-ink-150";
}

/** Five thin segments for cards and list rows. The caller prints the stage in words next to it. */
export function ProgressBar({ status, repairActive }: { status: ReportStatus; repairActive: boolean }) {
  const stage = reportStage(status, repairActive);
  return (
    <span className="flex gap-1" aria-hidden="true">
      {stage.labels.map((label, step) => (
        <span key={label} className={`h-1 flex-1 rounded-full ${segmentClass(stage, step)}`} />
      ))}
    </span>
  );
}

/** Full stepper for detail pages: a row on desktop, a vertical list on phones. */
export function ProgressStepper({ status, repairActive, notes = {} }: { status: ReportStatus; repairActive: boolean; notes?: Partial<Record<number, string>> }) {
  const stage = reportStage(status, repairActive);
  return (
    <ol aria-label="Report progress" className="flex flex-col gap-0 sm:flex-row sm:gap-1.5">
      {stage.labels.map((label, step) => {
        const done = step < stage.index;
        const current = step === stage.index;
        const tone = done ? "text-ink-900" : current ? (stage.closed ? "text-ink-600" : "text-cobalt-600") : "text-ink-500";
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="flex flex-1 gap-3 sm:flex-col sm:gap-1.5">
            {/* Phone: dot and connecting line. Desktop: one bar per step. */}
            <span className="flex w-4 flex-col items-center sm:hidden" aria-hidden="true">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  done ? "bg-ink-900 text-white" : current ? (stage.closed ? "bg-ink-400" : "border-4 border-cobalt-600 bg-white") : "border-2 border-ink-300 bg-white"
                }`}
              >
                {done && <Check className="size-3" strokeWidth={3} />}
              </span>
              {step < 4 && <span className={`my-0.5 w-0.5 flex-1 ${done ? "bg-ink-900" : "bg-ink-150"}`} />}
            </span>
            <span className={`hidden h-1 rounded-full sm:block ${segmentClass(stage, step)}`} aria-hidden="true" />
            <span className="pb-3 sm:pb-0">
              <span className={`block text-[13px] ${done || current ? "font-bold" : "font-medium"} ${tone}`}>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {notes[step] !== undefined && <span className="block text-xs text-ink-500">{notes[step]}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
