/**
 * Report and repair workflow rules (CLAUDE.md §3 status model, Stage 4 plan §4.1).
 * Pure functions: the services enforce them inside transactions with conditional updates.
 *
 * Report status (admins only):
 *   SUBMITTED → UNDER_REVIEW                         (Review)
 *   UNDER_REVIEW | DELAYED → ACCEPTED | REJECTED | DELAYED   (decision; DELAYED → DELAYED = keep delayed)
 *   ACCEPTED → COMPLETED  only when the current repair attempt is COMPLETED   (confirm)
 *   REJECTED and COMPLETED are final.
 *
 * Repair status (assigned engineer only), per attempt:
 *   PENDING → WORKING
 *   WORKING → COMPLETED   needs ≥ 1 photo of the current attempt
 *   COMPLETED → WORKING   reopen after admin feedback: starts a NEW attempt
 * PENDING is only the initial state of an attempt (set on assignment); no API sets it.
 */
import type { RepairStatus, ReportStatus, SeverityLevel } from "../generated/prisma/client.js";

export type Decision = "ACCEPT" | "REJECT" | "DELAY";
/** Repair statuses an engineer may request. */
export type RepairTarget = "WORKING" | "COMPLETED";

export const DECISION_TARGET: Readonly<Record<Decision, ReportStatus>> = {
  ACCEPT: "ACCEPTED",
  REJECT: "REJECTED",
  DELAY: "DELAYED",
};

const DECIDABLE_FROM: readonly ReportStatus[] = ["UNDER_REVIEW", "DELAYED"];
const NOTIFIED_STATUSES: readonly ReportStatus[] = ["ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"];

export function canReview(status: ReportStatus): boolean {
  return status === "SUBMITTED";
}

export function canDecide(status: ReportStatus): boolean {
  return DECIDABLE_FROM.includes(status);
}

/** Reject and Delay (including "keep delayed") require a reason; Accept takes an optional note. */
export function decisionRequiresReason(decision: Decision): boolean {
  return decision !== "ACCEPT";
}

/** Assignment and reassignment are only possible while the report is accepted (not yet completed). */
export function canAssign(status: ReportStatus): boolean {
  return status === "ACCEPTED";
}

/** Confirmation and "needs more work" feedback both require an attempt awaiting confirmation. */
export function isAwaitingConfirmation(status: ReportStatus, repairStatus: RepairStatus | null): boolean {
  return status === "ACCEPTED" && repairStatus === "COMPLETED";
}

export interface RepairTransition {
  allowed: boolean;
  /** WORKING → COMPLETED needs at least one photo of the current attempt. */
  requiresCurrentAttemptPhoto: boolean;
  /** COMPLETED → WORKING (reopen) starts a new attempt. */
  startsNewAttempt: boolean;
}

export function repairTransition(from: RepairStatus | null, to: RepairTarget): RepairTransition {
  if (from === "PENDING" && to === "WORKING") {
    return { allowed: true, requiresCurrentAttemptPhoto: false, startsNewAttempt: false };
  }
  if (from === "WORKING" && to === "COMPLETED") {
    return { allowed: true, requiresCurrentAttemptPhoto: true, startsNewAttempt: false };
  }
  if (from === "COMPLETED" && to === "WORKING") {
    return { allowed: true, requiresCurrentAttemptPhoto: false, startsNewAttempt: true };
  }
  return { allowed: false, requiresCurrentAttemptPhoto: false, startsNewAttempt: false };
}

/** Photos can be added while an attempt is open; a Completed attempt is frozen evidence. */
export function canUploadRepairPhoto(repairStatus: RepairStatus | null): boolean {
  return repairStatus === "PENDING" || repairStatus === "WORKING";
}

/** First assignment → 1; reassignment and reopen → +1. */
export function nextAttempt(current: number | null): number {
  return (current ?? 0) + 1;
}

/** The severity used for filters and counts: the admin's correction if any, else the AI estimate. */
export function effectiveSeverity(adminSeverity: SeverityLevel | null, aiSeverity: SeverityLevel | null): SeverityLevel | null {
  return adminSeverity ?? aiSeverity;
}

/** Citizens get an SMS only when the status actually changes to one of these (never for keep-delayed). */
export function shouldNotifyCitizen(from: ReportStatus, to: ReportStatus): boolean {
  return from !== to && NOTIFIED_STATUSES.includes(to);
}
