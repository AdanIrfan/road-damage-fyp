import type { NotificationType, Prisma, RepairStatus, ReportStatus } from "../generated/prisma/client.js";

/**
 * In-app notification events (Phase 6).
 *
 * Every function here takes the TRANSACTION CLIENT of the business operation it belongs to, so a
 * notification is stored only if that operation commits, and never for a refused or rolled-back
 * action. Rows are inserted with skipDuplicates on the unique (user_id, dedupe_key): the key is
 * built from the record that caused the event (status-history, assignment or repair-update id),
 * so a retried or concurrent request cannot add a second row.
 *
 * Texts never contain coordinates, phone numbers or citizen identity.
 */
export type Tx = Prisma.TransactionClient;

interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  reportId?: string;
  dedupeKey: string;
}

const BODY_MAX = 500;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

async function insert(tx: Tx, rows: NewNotification[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.notification.createMany({
    data: rows.map((row) => ({ ...row, title: clip(row.title, 120), body: clip(row.body, BODY_MAX), reportId: row.reportId ?? null })),
    skipDuplicates: true,
  });
}

/** Admin events go to every active admin (there is no "owner" of a report among admins). */
async function activeAdminIds(tx: Tx): Promise<string[]> {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  return admins.map((admin) => admin.id);
}

/** A report was created: confirmation for the citizen, a new item for admins (and an AI failure notice). */
export async function notifyReportSubmitted(tx: Tx, input: { reportId: string; citizenId: string; aiFailed: boolean }): Promise<void> {
  const admins = await activeAdminIds(tx);
  const rows: NewNotification[] = [
    {
      userId: input.citizenId,
      type: "REPORT_SUBMITTED",
      title: "Report submitted",
      body: "We received your report. An administrator will review it.",
      reportId: input.reportId,
      dedupeKey: `report:${input.reportId}:submitted`,
    },
    ...admins.map((userId) => ({
      userId,
      type: "NEW_REPORT" as const,
      title: "New report",
      body: "A citizen submitted a new road damage report.",
      reportId: input.reportId,
      dedupeKey: `report:${input.reportId}:new`,
    })),
  ];
  if (input.aiFailed) {
    rows.push(
      ...admins.map((userId) => ({
        userId,
        type: "AI_ANALYSIS_FAILED" as const,
        title: "Automatic analysis failed",
        body: "The report was saved without detections. Review the photo manually.",
        reportId: input.reportId,
        dedupeKey: `report:${input.reportId}:ai-failed`,
      })),
    );
  }
  await insert(tx, rows);
}

/**
 * An admin decision that really changed the status (keep-delayed and Start review do not notify).
 * `historyId` is the status-history row written by the same transaction.
 */
export async function notifyReportDecision(
  tx: Tx,
  input: { reportId: string; citizenId: string; from: ReportStatus; to: ReportStatus; reason: string | undefined; historyId: string },
): Promise<void> {
  if (input.from === input.to) return;
  const reason = input.reason ? ` Reason: ${input.reason}` : "";
  const content: Partial<Record<ReportStatus, { type: NotificationType; title: string; body: string }>> = {
    ACCEPTED: { type: "REPORT_ACCEPTED", title: "Report accepted", body: "Your report was accepted and a repair will be scheduled." },
    REJECTED: { type: "REPORT_REJECTED", title: "Report not accepted", body: `Your report was not accepted.${reason}` },
    DELAYED: { type: "REPORT_DELAYED", title: "Report delayed", body: `Your report has been delayed.${reason}` },
  };
  const entry = content[input.to];
  if (entry === undefined) return;
  await insert(tx, [{ userId: input.citizenId, ...entry, reportId: input.reportId, dedupeKey: `status:${input.historyId}` }]);
}

/** An admin confirmed the repair: the report is completed. Tells the citizen and the engineer who did it. */
export async function notifyRepairConfirmed(
  tx: Tx,
  input: { reportId: string; citizenId: string; engineerId: string | null; attempt: number; historyId: string },
): Promise<void> {
  const rows: NewNotification[] = [
    {
      userId: input.citizenId,
      type: "REPAIR_CONFIRMED",
      title: "Repair completed",
      body: "The damage you reported has been repaired and confirmed.",
      reportId: input.reportId,
      dedupeKey: `status:${input.historyId}`,
    },
  ];
  if (input.engineerId !== null) {
    rows.push({
      userId: input.engineerId,
      type: "REPAIR_CONFIRMED",
      title: "Repair confirmed",
      body: `An administrator confirmed attempt ${input.attempt}. The job is now in your history.`,
      reportId: input.reportId,
      dedupeKey: `status:${input.historyId}`,
    });
  }
  await insert(tx, rows);
}

/** Admin "needs more work" feedback on a completed attempt. */
export async function notifyReworkRequested(
  tx: Tx,
  input: { reportId: string; engineerId: string | null; note: string; updateId: string },
): Promise<void> {
  if (input.engineerId === null) return;
  await insert(tx, [
    {
      userId: input.engineerId,
      type: "REWORK_REQUESTED",
      title: "More work requested",
      body: input.note,
      reportId: input.reportId,
      dedupeKey: `update:${input.updateId}`,
    },
  ]);
}

/** A (re)assignment: the new engineer gets a job; the previous engineer is told it moved. */
export async function notifyAssignment(
  tx: Tx,
  input: { reportId: string; engineerId: string; previousEngineerId: string | null; assignmentId: string },
): Promise<void> {
  const rows: NewNotification[] = [
    {
      userId: input.engineerId,
      type: "JOB_ASSIGNED",
      title: "New job assigned",
      body: "A repair job was assigned to you.",
      reportId: input.reportId,
      dedupeKey: `assign:${input.assignmentId}`,
    },
  ];
  if (input.previousEngineerId !== null) {
    rows.push({
      userId: input.previousEngineerId,
      type: "JOB_REASSIGNED",
      title: "Job reassigned",
      body: "A job that was assigned to you has been given to another engineer.",
      // No report link: the previous engineer no longer has access to this job.
      dedupeKey: `assign:${input.assignmentId}`,
    });
  }
  await insert(tx, rows);
}

/**
 * The assigned engineer changed the repair status. Citizens never learn who the engineer is.
 *   PENDING -> WORKING            citizen: repair started
 *   WORKING -> COMPLETED          citizen: awaiting final check; admins: awaiting confirmation
 *   COMPLETED -> WORKING (reopen) citizen: further work under way
 */
export async function notifyRepairStatusChanged(
  tx: Tx,
  input: { reportId: string; from: RepairStatus; to: RepairStatus; attempt: number; updateId: string },
): Promise<void> {
  const report = await tx.report.findUnique({ where: { id: input.reportId }, select: { citizenId: true } });
  if (report === null) return;
  const dedupeKey = `update:${input.updateId}`;
  const rows: NewNotification[] = [];
  if (input.from === "PENDING" && input.to === "WORKING") {
    rows.push({
      userId: report.citizenId,
      type: "REPAIR_STARTED",
      title: "Repair started",
      body: "Work has started on the damage you reported.",
      reportId: input.reportId,
      dedupeKey,
    });
  } else if (input.to === "COMPLETED") {
    rows.push({
      userId: report.citizenId,
      type: "REPAIR_UPDATED",
      title: "Repair work finished",
      body: "The repair work is done and is waiting for a final check by an administrator.",
      reportId: input.reportId,
      dedupeKey,
    });
    for (const userId of await activeAdminIds(tx)) {
      rows.push({
        userId,
        type: "REPAIR_AWAITING_CONFIRMATION",
        title: "Repair awaiting confirmation",
        body: `The engineer marked attempt ${input.attempt} as completed. Check the photos and confirm, or ask for more work.`,
        reportId: input.reportId,
        dedupeKey,
      });
    }
  } else if (input.from === "COMPLETED" && input.to === "WORKING") {
    rows.push({
      userId: report.citizenId,
      type: "REPAIR_UPDATED",
      title: "Further repair work",
      body: "More work is being done on the damage you reported.",
      reportId: input.reportId,
      dedupeKey,
    });
  }
  await insert(tx, rows);
}

/**
 * Chat: ONE row per recipient per conversation (not one per message). A new message refreshes
 * that row (latest text and time) and makes it unread again; opening the conversation marks it read.
 */
export async function notifyChatMessage(
  tx: Tx,
  input: { conversationId: string; senderId: string; recipientId: string; body: string; sentAt: Date },
): Promise<void> {
  const sender = await tx.user.findUnique({ where: { id: input.senderId }, select: { fullName: true } });
  const title = clip(`New message from ${sender?.fullName ?? "your contact"}`, 120);
  const body = clip(input.body, 160);
  const dedupeKey = `chat:${input.conversationId}`;
  await tx.notification.upsert({
    where: { userId_dedupeKey: { userId: input.recipientId, dedupeKey } },
    create: { userId: input.recipientId, type: "CHAT_MESSAGE", title, body, conversationId: input.conversationId, dedupeKey, createdAt: input.sentAt },
    update: { title, body, readAt: null, createdAt: input.sentAt },
  });
}
