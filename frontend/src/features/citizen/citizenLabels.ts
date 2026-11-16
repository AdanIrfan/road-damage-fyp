import { repairProgressLabel } from "../../components/reports/labels";
import type { RepairProgress, ReportStatus } from "../../lib/reportTypes";

/** True once an engineer has been assigned (the citizen's "Repair" step has begun). */
export function repairBegun(progress: RepairProgress | null): boolean {
  return progress !== null && progress !== "NOT_ASSIGNED";
}

/** One line in the citizen's words about where a report stands. */
export function citizenStageText(status: ReportStatus, progress: RepairProgress | null): string {
  switch (status) {
    case "SUBMITTED":
      return "Waiting for an administrator to review it";
    case "UNDER_REVIEW":
      return "Under review by an administrator";
    case "DELAYED":
      return "Delayed · open to see the reason";
    case "REJECTED":
      return "Not accepted · open to see the reason";
    case "ACCEPTED":
      return progress === null || progress === "NOT_ASSIGNED" ? "Accepted · repair not scheduled yet" : repairProgressLabel[progress];
    case "COMPLETED":
      return "Repaired and confirmed";
  }
}
