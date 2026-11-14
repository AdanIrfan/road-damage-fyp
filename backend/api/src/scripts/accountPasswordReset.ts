import type { CountryCode } from "libphonenumber-js/max";
import type { PrismaClient } from "../db/prisma.js";
import type { AccountStatus, UserRole } from "../generated/prisma/client.js";
import {
  findAccountByMobile,
  passwordProblem,
  PasswordResetError,
  resetAccountPassword,
} from "../services/passwordReset.service.js";
import { normalizeMobileNumber } from "../utils/phone.js";
import type { Prompter } from "./prompt.js";

export type ResetOutcome = "reset" | "cancelled";

export interface PasswordResetDependencies {
  prisma: PrismaClient;
  prompt: Prompter;
  /** Where messages go (the terminal in the CLI, an array in tests). */
  print: (line: string) => void;
  defaultCountry: CountryCode | undefined;
}

const roleLabel: Record<UserRole, string> = { ADMIN: "Admin", ENGINEER: "Engineer", CITIZEN: "Citizen" };
const statusLabel: Record<AccountStatus, string> = {
  ACTIVE: "Active",
  PENDING_VERIFICATION: "Pending mobile verification",
  DEACTIVATED: "Deactivated",
};

/**
 * Interactive password reset for one existing account (any role). Asks for the mobile number,
 * shows the account for confirmation, then asks for the new password twice (hidden).
 * Throws PasswordResetError for expected problems; nothing is changed in that case.
 * Never prints a password or a password hash.
 */
export async function runAccountPasswordReset(deps: PasswordResetDependencies): Promise<ResetOutcome> {
  const { prisma, prompt, print, defaultCountry } = deps;

  const rawMobile = await prompt.ask("Mobile number of the account (with country code): ");
  const mobileNumber = normalizeMobileNumber(rawMobile, defaultCountry);
  if (mobileNumber === undefined) {
    throw new PasswordResetError("That is not a valid mobile number. Include the country code, for example +92 300 1234567.");
  }

  const account = await findAccountByMobile(prisma, mobileNumber);
  if (account === null) {
    throw new PasswordResetError(`No account uses ${mobileNumber}. Nothing was changed.`);
  }

  print("");
  print("Account found:");
  print(`  Name:   ${account.fullName}`);
  print(`  Mobile: ${account.mobileNumber}`);
  print(`  Role:   ${roleLabel[account.role]}`);
  print(`  Status: ${statusLabel[account.status]}`);
  print("");
  for (const line of statusNotes(account.status)) {
    print(line);
  }

  const answer = (await prompt.ask(`Reset the password of ${account.fullName} (${roleLabel[account.role]})? Type "yes" to continue: `)).trim();
  if (answer.toLowerCase() !== "yes") {
    print("Cancelled. Nothing was changed.");
    return "cancelled";
  }

  const password = await prompt.ask("New password (8-128 characters, hidden): ", true);
  const problem = passwordProblem(password);
  if (problem !== undefined) {
    throw new PasswordResetError(`${problem} Nothing was changed.`);
  }
  if ((await prompt.ask("Confirm new password (hidden): ", true)) !== password) {
    throw new PasswordResetError("The passwords do not match. Nothing was changed.");
  }

  const { revokedSessions } = await resetAccountPassword(prisma, account.id, password);
  print("");
  print(`Password updated for ${account.fullName} (${roleLabel[account.role]}).`);
  print(
    revokedSessions === 0
      ? "There were no active logins to sign out."
      : `${revokedSessions} existing login session(s) were signed out; they must log in again with the new password.`,
  );
  for (const line of statusNotes(account.status, true)) {
    print(line);
  }
  return "reset";
}

/** Explains statuses that a password reset does NOT change. */
function statusNotes(status: AccountStatus, afterReset = false): string[] {
  switch (status) {
    case "PENDING_VERIFICATION":
      return [
        afterReset
          ? "Note: the account is STILL pending mobile verification and cannot log in yet."
          : "Note: this citizen has not verified their mobile number. A password reset does NOT verify or activate the account.",
        "      To activate it, log in or open the Verify page in the app, request a new code (in development the code is",
        "      printed in the API console), and enter it.",
      ];
    case "DEACTIVATED":
      return [
        afterReset
          ? "Note: the account is STILL deactivated and cannot log in until it is reactivated."
          : "Note: this account is deactivated. A password reset does NOT reactivate it.",
      ];
    case "ACTIVE":
      return [];
  }
}
