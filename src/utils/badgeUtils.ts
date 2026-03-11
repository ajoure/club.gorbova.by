/**
 * Single source of truth for status badge styling.
 * All status badges use variant="outline" + className from this helper.
 */
export type StatusBadgeKind = "active" | "inactive" | "warning" | "archived" | "hidden";

const STATUS_BADGE_CLASSES: Record<StatusBadgeKind, string> = {
  active: "text-primary/70 border-primary/20 bg-primary/5",
  inactive: "text-muted-foreground",
  warning: "text-amber-600/70 border-amber-200/50 bg-amber-50/30 dark:text-amber-400/70 dark:border-amber-800/50 dark:bg-amber-950/30",
  archived: "text-muted-foreground",
  hidden: "text-muted-foreground",
};

export function getStatusBadgeClass(kind: StatusBadgeKind): string {
  return STATUS_BADGE_CLASSES[kind] ?? STATUS_BADGE_CLASSES.inactive;
}
