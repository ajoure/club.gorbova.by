/**
 * Canonical room role helpers.
 * Single source of truth for webinar room permission checks.
 * Maps to the permissions matrix in the plan.
 */

type AppRole = string;

/** Staff = can reply, delete, mute, open profile, mark answered */
export function isStaffRole(role: AppRole | undefined | null): boolean {
  return role === "admin" || role === "superadmin" || role === "employee";
}

/** Admin = staff + remove/restore from room, show/hide sales blocks */
export function isAdminRole(role: AppRole | undefined | null): boolean {
  return role === "admin" || role === "superadmin";
}

/** Can moderate messages (delete/hide, mute/unmute) */
export function canModerateMessages(role: AppRole | undefined | null): boolean {
  return isStaffRole(role);
}

/** Can remove/restore user from room (admin-only) */
export function canRemoveFromRoom(role: AppRole | undefined | null): boolean {
  return isAdminRole(role);
}
