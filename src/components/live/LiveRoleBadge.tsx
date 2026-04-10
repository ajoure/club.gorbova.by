/**
 * Unified role badge and highlight for webinar room messages.
 * Single source of truth — used by both Comments and Questions.
 */

import { Badge } from "@/components/ui/badge";

export type AuthorRole = "admin" | "employee" | "user";

const ROLE_LABELS: Record<AuthorRole, string | null> = {
  admin: "Админ",
  employee: "Сотрудник",
  user: null,
};

const ROLE_BADGE_CLASSES: Record<AuthorRole, string> = {
  admin: "bg-destructive/10 text-destructive border-destructive/20",
  employee: "bg-destructive/10 text-destructive border-destructive/20",
  user: "",
};

/** Returns the role badge label, or null for regular users */
export function getRoleBadgeLabel(role: AuthorRole | string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role as AuthorRole] ?? null;
}

/** CSS class for message row highlight (admin/employee = red tint) */
export function getMessageHighlightClass(role: AuthorRole | string | null | undefined): string {
  if (role === "admin" || role === "employee") {
    return "bg-destructive/5 border-l-2 border-l-destructive/30";
  }
  return "";
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
