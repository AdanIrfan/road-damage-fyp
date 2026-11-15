import { SMS_REASON_MAX_LENGTH } from "../config/workflow.js";
import { maskMobileNumber } from "../utils/phone.js";
import type { SmsSender } from "./sms/index.js";

/** Report statuses that trigger a citizen SMS (only on a real status change; see reportWorkflow). */
export type CitizenNotifiedStatus = "ACCEPTED" | "REJECTED" | "DELAYED" | "COMPLETED";
export type NotificationOutcome = "sent" | "failed";

export interface CitizenStatusNotification {
  reportId: string;
  citizenMobile: string;
  status: CitizenNotifiedStatus;
  reason?: string | null | undefined;
}

export interface NotificationService {
  /**
   * Sends the citizen an SMS about a status change. Call it only AFTER the status change has been
   * committed. It never throws: a failure is logged (with a masked number) and reported as "failed"
   * so the decision itself is never undone by an SMS problem.
   */
  notifyCitizenStatus(input: CitizenStatusNotification): Promise<NotificationOutcome>;
}

/** Short, human-friendly report reference used in messages (first 8 characters of the id). */
export function reportReference(reportId: string): string {
  return `#${reportId.slice(0, 8).toUpperCase()}`;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= SMS_REASON_MAX_LENGTH ? clean : `${clean.slice(0, SMS_REASON_MAX_LENGTH - 1)}…`;
}

/** Message texts. They never contain coordinates, photos or internal details. */
export function citizenStatusMessage({ reportId, status, reason }: Omit<CitizenStatusNotification, "citizenMobile">): string {
  const ref = reportReference(reportId);
  switch (status) {
    case "ACCEPTED":
      return `Road damage report ${ref} was accepted and will be scheduled for repair. Thank you for reporting it.`;
    case "REJECTED":
      return `Road damage report ${ref} was not accepted.${reason ? ` Reason: ${shorten(reason)}` : ""}`;
    case "DELAYED":
      return `Road damage report ${ref} has been delayed.${reason ? ` Reason: ${shorten(reason)}` : ""}`;
    case "COMPLETED":
      return `The repair for road damage report ${ref} has been completed. Thank you for reporting it.`;
  }
}

export function createNotificationService(sms: SmsSender): NotificationService {
  return {
    notifyCitizenStatus: async (input) => {
      try {
        await sms.send(input.citizenMobile, citizenStatusMessage(input));
        return "sent";
      } catch (error) {
        console.warn(
          `SMS notification failed (event ${input.status}, report ${input.reportId}, to ${maskMobileNumber(input.citizenMobile)}): ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
        return "failed";
      }
    },
  };
}
