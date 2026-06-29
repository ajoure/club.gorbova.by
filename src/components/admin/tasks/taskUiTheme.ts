/**
 * Tasks UI — общий glass-стиль для канбан-карточек и диалогов.
 * Цвета (red/amber/sky/slate/violet) совпадают с bucket-колонками
 * `TaskKanbanBoard` и не должны меняться разрозненно по файлам.
 */

export type TaskBucketId =
  | "overdue"
  | "today"
  | "tomorrow"
  | "later"
  | "no_due";

export interface TaskBucketTheme {
  accent: string; // hex для type-stripe / fallback
  cardGradient: string; // Tailwind classes для bg карточки
  ring: string; // Tailwind ring classes
}

export const TASK_BUCKET_THEME: Record<TaskBucketId, TaskBucketTheme> = {
  overdue: {
    accent: "#dc2626",
    cardGradient:
      "bg-gradient-to-br from-rose-100/70 via-white/75 to-white/55",
    ring: "ring-1 ring-rose-200/60",
  },
  today: {
    accent: "#f59e0b",
    cardGradient:
      "bg-gradient-to-br from-amber-100/70 via-white/75 to-white/55",
    ring: "ring-1 ring-amber-200/60",
  },
  tomorrow: {
    accent: "#0ea5e9",
    cardGradient:
      "bg-gradient-to-br from-sky-100/70 via-white/75 to-white/55",
    ring: "ring-1 ring-sky-200/60",
  },
  later: {
    accent: "#64748b",
    cardGradient:
      "bg-gradient-to-br from-slate-100/70 via-white/75 to-white/55",
    ring: "ring-1 ring-slate-200/60",
  },
  no_due: {
    accent: "#a78bfa",
    cardGradient:
      "bg-gradient-to-br from-violet-100/70 via-white/75 to-white/55",
    ring: "ring-1 ring-violet-200/60",
  },
};

// Карточка задачи: glass-контейнер.
export const TASK_CARD_GLASS =
  "relative overflow-hidden rounded-xl border border-white/70 backdrop-blur-md " +
  "shadow-[0_4px_14px_-6px_rgba(15,23,42,0.12)] " +
  "transition-all duration-200 hover:-translate-y-0.5 " +
  "hover:shadow-[0_8px_22px_-8px_rgba(15,23,42,0.18)]";

// Pill для бейджей срока/напоминания внутри карточки.
export const TASK_CARD_PILL =
  "inline-flex items-center gap-1 rounded-full bg-white/75 backdrop-blur-sm " +
  "border border-white/70 px-2 py-0.5 text-[11px] shadow-sm";

// Стекло для диалогов.
export const TASK_DIALOG_GLASS =
  "bg-white/90 backdrop-blur-xl border border-white/70 shadow-2xl rounded-2xl";

// Секция внутри диалога.
export const TASK_DIALOG_SECTION =
  "rounded-xl bg-slate-50/70 backdrop-blur-sm border border-white/60 p-3 space-y-3";

// CTA Save (gradient).
export const TASK_DIALOG_SAVE_CTA =
  "bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:from-sky-600 hover:to-indigo-600 border-0 shadow-md";
