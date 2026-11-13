import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Validates a mobile number and returns it in E.164 format (e.g. +447700900123),
 * or undefined if it is not a valid mobile number.
 * Without a default country, the number must include its +country code.
 */
export function normalizeMobileNumber(input: string, defaultCountry?: CountryCode): string | undefined {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (parsed === undefined || !parsed.isValid()) {
    return undefined;
  }
  const type = parsed.getType();
  // Some regions cannot distinguish mobile from fixed lines; reject only numbers known not to be mobile.
  if (type !== undefined && type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
    return undefined;
  }
  return parsed.number;
}

/** Shows only the last few digits, for logs. */
export function maskMobileNumber(e164: string): string {
  return `${"*".repeat(Math.max(0, e164.length - 3))}${e164.slice(-3)}`;
}
