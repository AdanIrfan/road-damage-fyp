import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RepairStatus, ReportStatus } from "../src/generated/prisma/client.js";
import {
  canAssign,
  canDecide,
  canReview,
  canUploadRepairPhoto,
  decisionRequiresReason,
  effectiveSeverity,
  isAwaitingConfirmation,
  nextAttempt,
  repairTransition,
  shouldNotifyCitizen,
} from "../src/services/reportWorkflow.js";

const STATUSES: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"];
const REPAIR: (RepairStatus | null)[] = [null, "PENDING", "WORKING", "COMPLETED"];

describe("report workflow rules", () => {
  it("allows Review only from SUBMITTED", () => {
    assert.deepEqual(STATUSES.filter(canReview), ["SUBMITTED"]);
  });

  it("allows decisions only from UNDER_REVIEW and DELAYED (re-review of delayed reports)", () => {
    assert.deepEqual(STATUSES.filter(canDecide), ["UNDER_REVIEW", "DELAYED"]);
  });

  it("requires a reason for Reject and Delay, not for Accept", () => {
    assert.equal(decisionRequiresReason("REJECT"), true);
    assert.equal(decisionRequiresReason("DELAY"), true);
    assert.equal(decisionRequiresReason("ACCEPT"), false);
  });

  it("allows assignment only for ACCEPTED reports", () => {
    assert.deepEqual(STATUSES.filter(canAssign), ["ACCEPTED"]);
  });

  it("treats only ACCEPTED + repair COMPLETED as awaiting confirmation (confirm and feedback)", () => {
    for (const status of STATUSES) {
      for (const repair of REPAIR) {
        assert.equal(isAwaitingConfirmation(status, repair), status === "ACCEPTED" && repair === "COMPLETED", `${status}/${String(repair)}`);
      }
    }
  });

  it("notifies citizens only on a real change to ACCEPTED, REJECTED, DELAYED or COMPLETED", () => {
    assert.equal(shouldNotifyCitizen("UNDER_REVIEW", "ACCEPTED"), true);
    assert.equal(shouldNotifyCitizen("UNDER_REVIEW", "REJECTED"), true);
    assert.equal(shouldNotifyCitizen("UNDER_REVIEW", "DELAYED"), true);
    assert.equal(shouldNotifyCitizen("ACCEPTED", "COMPLETED"), true);
    assert.equal(shouldNotifyCitizen("DELAYED", "DELAYED"), false, "keep delayed: no SMS");
    assert.equal(shouldNotifyCitizen("SUBMITTED", "UNDER_REVIEW"), false, "review: no SMS");
  });

  it("uses the admin severity when set, otherwise the AI estimate", () => {
    assert.equal(effectiveSeverity("HIGH", "LOW"), "HIGH");
    assert.equal(effectiveSeverity(null, "LOW"), "LOW");
    assert.equal(effectiveSeverity(null, null), null);
  });
});

describe("repair workflow rules (per attempt)", () => {
  it("allows exactly PENDING→WORKING, WORKING→COMPLETED and COMPLETED→WORKING", () => {
    const allowed: string[] = [];
    for (const from of REPAIR) {
      for (const to of ["WORKING", "COMPLETED"] as const) {
        if (repairTransition(from, to).allowed) allowed.push(`${String(from)}→${to}`);
      }
    }
    assert.deepEqual(allowed, ["PENDING→WORKING", "WORKING→COMPLETED", "COMPLETED→WORKING"]);
  });

  it("needs a current-attempt photo to complete and starts a new attempt on reopen", () => {
    assert.deepEqual(repairTransition("WORKING", "COMPLETED"), { allowed: true, requiresCurrentAttemptPhoto: true, startsNewAttempt: false });
    assert.deepEqual(repairTransition("COMPLETED", "WORKING"), { allowed: true, requiresCurrentAttemptPhoto: false, startsNewAttempt: true });
    assert.deepEqual(repairTransition("PENDING", "WORKING"), { allowed: true, requiresCurrentAttemptPhoto: false, startsNewAttempt: false });
    assert.equal(repairTransition("PENDING", "COMPLETED").allowed, false, "cannot skip Working");
    assert.equal(repairTransition(null, "WORKING").allowed, false, "unassigned report");
  });

  it("accepts photos only while an attempt is open", () => {
    assert.deepEqual(REPAIR.filter(canUploadRepairPhoto), ["PENDING", "WORKING"]);
  });

  it("numbers attempts 1, 2, 3 … and never goes back", () => {
    assert.equal(nextAttempt(null), 1);
    assert.equal(nextAttempt(1), 2);
    assert.equal(nextAttempt(7), 8);
  });
});
