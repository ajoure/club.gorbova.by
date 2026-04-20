/**
 * Unified role badge and highlight for webinar room messages.
 * Single source of truth — used by both Comments and Questions.
 *
 * IMPORTANT: `presenter` is NOT a system auth role.
 * It is a visual room-label, derived from `live_events.metadata.presenter_user_id`.
 * Permissions/moderation are unaffected.
 */

import { Badge } from "@/components/ui/badge";

export type AuthorRole = "presenter" | "admin" | "employee" | "user";

const ROLE_LABELS: Record<AuthorRole, string | null> = {
  presenter: "Ведущий",
  admin: "Админ",
  employee: "Сотрудник",
  user: null,
};

/** Badge styling per role — visually distinct (not all red). */
const ROLE_BADGE_CLASSES: Record<AuthorRole, string> = {
  presenter:
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40 font-semibold",
  admin: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
  employee:
    "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
  user: "",
};

/** Message row highlight — strongest for presenter, distinct for staff. */
const ROLE_HIGHLIGHT_CLASSES: Record<AuthorRole, string> = {
  presenter:
    "bg-amber-500/10 border-l-2 border-l-amber-500 ring-1 ring-amber-500/20",
  admin: "bg-rose-500/5 border-l-2 border-l-rose-500/50",
  employee: "bg-violet-500/5 border-l-2 border-l-violet-500/40",
  user: "",
};

/** Returns the role badge label, or null for regular users */
export function getRoleBadgeLabel(role: AuthorRole | string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role as AuthorRole] ?? null;
}

/** CSS class for message row highlight */
export function getMessageHighlightClass(role: AuthorRole | string | null | undefined): string {
  if (!role) return "";
  return ROLE_HIGHLIGHT_CLASSES[role as AuthorRole] || "";
}

/** Highlight class for own messages (separate visual lane). */
export function getOwnMessageClass(): string {
  return "bg-primary/5 border-l-2 border-l-primary/40";
}

/** Role badge component — renders nothing for regular users */
export function LiveRoleBadge({ role }: { role: AuthorRole | string | null | undefined }) {
  const label = getRoleBadgeLabel(role);
  if (!label) return null;

  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1 py-0 leading-tight ${ROLE_BADGE_CLASSES[role as AuthorRole] || ""}`}
    >
      {label}
    </Badge>
  );
}
