/**
 * Tasks UI — premium glass-стиль для канбан-карточек и диалогов.
 * Палитра: emerald / amber / teal / rose / violet (без серого, "дорогие" акценты).
 * Все стили локальны — глобальная тема проекта не меняется.
 */

export type TaskBucketId =
  | "overdue"
  | "today"
  | "tomorrow"
  | "later"
  | "no_due";

export interface TaskBucketTheme {
  accent: string;
  cardGradient: string;
  ring: string;
  glow: string;
}

export const TASK_BUCKET_THEME: Record<TaskBucketId, TaskBucketTheme> = {
  overdue: {
    accent: "#e11d48",
    cardGradient:
      "bg-gradient-to-br from-rose-50/70 via-white/45 to-rose-100/40",
    ring: "ring-1 ring-rose-300/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(225,29,72,0.45)]",
  },
  today: {
    accent: "#d97706",
    cardGradient:
      "bg-gradient-to-br from-amber-50/70 via-white/45 to-amber-100/40",
    ring: "ring-1 ring-amber-300/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(217,119,6,0.45)]",
  },
  tomorrow: {
    accent: "#0d9488",
    cardGradient:
      "bg-gradient-to-br from-teal-50/70 via-white/45 to-teal-100/40",
    ring: "ring-1 ring-teal-300/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(13,148,136,0.45)]",
  },
  later: {
    accent: "#059669",
    cardGradient:
      "bg-gradient-to-br from-emerald-50/70 via-white/45 to-emerald-100/40",
    ring: "ring-1 ring-emerald-300/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(5,150,105,0.45)]",
  },
  no_due: {
    accent: "#7c3aed",
    cardGradient:
      "bg-gradient-to-br from-violet-50/70 via-white/45 to-violet-100/40",
    ring: "ring-1 ring-violet-300/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(124,58,237,0.45)]",
  },
};

// Карточка задачи: усиленное матовое стекло.
export const TASK_CARD_GLASS =
  "relative overflow-hidden rounded-xl border border-white/60 backdrop-blur-xl " +
  "shadow-[0_4px_18px_-8px_rgba(15,23,42,0.18)] " +
  "transition-all duration-200 hover:-translate-y-0.5";

// Pill для бейджей срока/напоминания внутри карточки.
export const TASK_CARD_PILL =
  "inline-flex items-center gap-1 rounded-full bg-white/70 backdrop-blur-sm " +
  "border border-white/60 px-2 py-0.5 text-[11px] shadow-sm";

// Стекло для диалогов.
export const TASK_DIALOG_GLASS =
  "bg-gradient-to-br from-emerald-50/60 via-white/85 to-teal-50/40 " +
  "backdrop-blur-xl border border-white/70 shadow-2xl rounded-2xl";

// Секция внутри диалога.
export const TASK_DIALOG_SECTION =
  "rounded-xl bg-white/60 backdrop-blur-sm border border-white/70 p-3 space-y-3 " +
  "shadow-[0_2px_10px_-6px_rgba(15,23,42,0.10)]";

// CTA Save (gradient — emerald → teal, premium).
export const TASK_DIALOG_SAVE_CTA =
  "bg-gradient-to-r from-emerald-500 to-teal-500 text-white " +
  "hover:from-emerald-600 hover:to-teal-600 border-0 shadow-md";

// CTA для "Готово" (success — emerald).
export const TASK_DIALOG_DONE_CTA =
  "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white " +
  "hover:from-emerald-600 hover:to-emerald-700 border-0 shadow-md";

// CTA для "Отменить задачу" (destructive-soft — rose).
export const TASK_DIALOG_CANCEL_CTA =
  "bg-gradient-to-r from-rose-500 to-rose-600 text-white " +
  "hover:from-rose-600 hover:to-rose-700 border-0 shadow-md";

// CTA для "В работу" (warm — amber).
export const TASK_DIALOG_INPROGRESS_CTA =
  "bg-gradient-to-r from-amber-500 to-orange-500 text-white " +
  "hover:from-amber-600 hover:to-orange-600 border-0 shadow-md";

// Статус-бейджи (для read-only chip и карточек).
export const TASK_STATUS_BADGE: Record<string, string> = {
  open: "bg-teal-100/80 text-teal-800 border-teal-200",
  in_progress: "bg-amber-100/80 text-amber-800 border-amber-200",
  done: "bg-emerald-100/80 text-emerald-800 border-emerald-200",
  canceled: "bg-rose-100/80 text-rose-800 border-rose-200",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  open: "Открыта",
  in_progress: "В работе",
  done: "Готово",
  canceled: "Отменена",
};
