/**
 * Centralized impersonation storage helper.
 * Single source of truth for all impersonation localStorage keys.
 * No component should manipulate these keys directly — use this module.
 */

const KEYS = {
  ADMIN_SESSION_BACKUP: "admin_session_backup",
  IS_IMPERSONATING: "is_impersonating",
  IMPERSONATION_START: "impersonation_start_time",
  ADMIN_RETURN_URL: "admin_return_url",
  ADMIN_TOKEN: "admin_token",
  ADMIN_SESSION: "admin_session",
} as const;

const MAX_IMPERSONATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Remove all impersonation-related keys from localStorage.
 * Safe to call at any time — no signOut, no toast, no redirect.
 */
export function clearImpersonationStorage(): void {
  Object.values(KEYS).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage unavailable
    }
  });
}

/**
 * Check if there is a valid, non-expired impersonation state.
 * Returns true only when ALL conditions are met:
 *   - is_impersonating === "true"
 *   - admin_session_backup exists
 *   - impersonation_start_time exists
 *   - TTL has not expired
 */
export function isValidImpersonationState(): boolean {
  try {
    const flag = localStorage.getItem(KEYS.IS_IMPERSONATING);
    const backup = localStorage.getItem(KEYS.ADMIN_SESSION_BACKUP);
    const startStr = localStorage.getItem(KEYS.IMPERSONATION_START);

    if (flag !== "true" || !backup || !startStr) return false;

    const elapsed = Date.now() - parseInt(startStr, 10);
    return elapsed <= MAX_IMPERSONATION_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Check if there is stale / garbage impersonation state that should be cleaned.
 * Returns true if any impersonation key exists but the state is not valid.
 */
export function hasStaleImpersonationState(): boolean {
  try {
    const hasAnyKey = Object.values(KEYS).some(
      (key) => localStorage.getItem(key) !== null
    );
    return hasAnyKey && !isValidImpersonationState();
  } catch {
    return false;
  }
}

/**
 * Get the stored admin session backup (for restoring after impersonation).
 */
export function getAdminSessionBackup(): { access_token: string; refresh_token: string } | null {
  try {
    const raw = localStorage.getItem(KEYS.ADMIN_SESSION_BACKUP);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.access_token && parsed?.refresh_token) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the stored admin return URL.
 */
export function getAdminReturnUrl(): string {
  try {
    return localStorage.getItem(KEYS.ADMIN_RETURN_URL) || "/admin/contacts";
  } catch {
    return "/admin/contacts";
  }
}

/**
 * Save impersonation state when starting impersonation.
 */
export function saveImpersonationState(adminSession: { access_token: string; refresh_token: string }, returnUrl: string): void {
  try {
    localStorage.setItem(KEYS.ADMIN_SESSION_BACKUP, JSON.stringify(adminSession));
    localStorage.setItem(KEYS.ADMIN_RETURN_URL, returnUrl);
    localStorage.setItem(KEYS.IS_IMPERSONATING, "true");
    localStorage.setItem(KEYS.IMPERSONATION_START, Date.now().toString());
  } catch {
    // localStorage unavailable
  }
}

export { KEYS as IMPERSONATION_KEYS };
