/**
 * Feature flag: which inline-auth UX is served on public/identity flows.
 *
 * "otp"  — OTP-first flow (email → 6-digit code → session), NO new-tab redirect.
 * "link" — legacy password + email-confirmation-link flow via `useInlineAuth`.
 *
 * Default: "otp" (approved for staging in PATCH-INLINE-AUTH-EMAIL-OTP-FLOW).
 * Rollback: set VITE_INLINE_AUTH_MODE=link and rebuild.
 *
 * NOTE: only inline flows read this flag. The main `/auth` page, recovery,
 * invite, email-change and reauthentication are unaffected.
 */
export type InlineAuthMode = "otp" | "link";

export function getInlineAuthMode(): InlineAuthMode {
  const raw = ((import.meta as any)?.env?.VITE_INLINE_AUTH_MODE ?? "").toString().trim().toLowerCase();
  if (raw === "link") return "link";
  return "otp";
}

export const INLINE_AUTH_MODE: InlineAuthMode = getInlineAuthMode();
