import type { AccountStatus, UserRole } from "../lib/types";

export const roleLabel: Record<UserRole, string> = {
  CITIZEN: "Citizen",
  ADMIN: "Administrator",
  ENGINEER: "Maintenance engineer",
};

export const statusLabel: Record<AccountStatus, string> = {
  PENDING_VERIFICATION: "Pending verification",
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
};

export const statusTone: Record<AccountStatus, "green" | "red" | "amber"> = {
  PENDING_VERIFICATION: "amber",
  ACTIVE: "green",
  DEACTIVATED: "red",
};

export function formatDate(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** First message for a field from a server validation error. */
export function firstError(errors: Record<string, string[] | undefined>, field: string): string | undefined {
  return errors[field]?.[0];
}
