/**
 * Feature flag: which inline-auth UX is served on public/identity flows.
 *
 * "link" — password-first flow (email+password sign-in, register with email
 *          confirmation, forgot-password recovery). This is the DEFAULT and
 *          the canonical business rule as of PATCH-INLINE-AUTH-PASSWORD-TABS:
 *          existing users MUST log in with a password, never with an OTP.
 * "otp"  — legacy OTP-first flow (email → 6-digit code → session). Kept only
 *          as an opt-in escape hatch via VITE_INLINE_AUTH_MODE=otp for
 *          non-production experimentation.
 *
 * NOTE: only inline flows read this flag. The main `/auth` page, recovery,
 * invite, email-change and reauthentication are unaffected.
 */
export type InlineAuthMode = "otp" | "link";

export function getInlineAuthMode(): InlineAuthMode {
  const raw = ((import.meta as any)?.env?.VITE_INLINE_AUTH_MODE ?? "").toString().trim().toLowerCase();
  if (raw === "otp") return "otp";
  return "link";
}

export const INLINE_AUTH_MODE: InlineAuthMode = getInlineAuthMode();
