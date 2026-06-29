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
      "bg-gradient-to-br from-rose-50/55 via-white/35 to-rose-100/30",
    ring: "ring-1 ring-rose-200/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(225,29,72,0.40)]",
  },
  today: {
    accent: "#d97706",
    cardGradient:
      "bg-gradient-to-br from-amber-50/55 via-white/35 to-amber-100/30",
    ring: "ring-1 ring-amber-200/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(217,119,6,0.40)]",
  },
  tomorrow: {
    accent: "#0d9488",
    cardGradient:
      "bg-gradient-to-br from-teal-50/55 via-white/35 to-teal-100/30",
    ring: "ring-1 ring-teal-200/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(13,148,136,0.40)]",
  },
  later: {
    accent: "#059669",
    cardGradient:
      "bg-gradient-to-br from-emerald-50/55 via-white/35 to-emerald-100/30",
    ring: "ring-1 ring-emerald-200/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(5,150,105,0.40)]",
  },
  no_due: {
    accent: "#7c3aed",
    cardGradient:
      "bg-gradient-to-br from-violet-50/55 via-white/35 to-violet-100/30",
    ring: "ring-1 ring-violet-200/50",
    glow: "hover:shadow-[0_10px_30px_-12px_rgba(124,58,237,0.40)]",
  },
};

// Карточка задачи: усиленное матовое стекло (более прозрачное, "frosted").
export const TASK_CARD_GLASS =
  "relative overflow-hidden rounded-xl border border-white/55 backdrop-blur-2xl " +
  "shadow-[0_4px_18px_-8px_rgba(15,23,42,0.14)] " +
  "transition-all duration-200 hover:-translate-y-0.5";

// Pill для бейджей срока/напоминания внутри карточки.
export const TASK_CARD_PILL =
  "inline-flex items-center gap-1 rounded-full bg-white/60 backdrop-blur-sm " +
  "border border-white/55 px-2 py-0.5 text-[11px] shadow-sm";

// Стекло для диалогов — выраженное матовое отделение от подложки.
export const TASK_DIALOG_GLASS =
  "bg-gradient-to-br from-emerald-50/55 via-white/60 to-teal-50/40 " +
  "backdrop-blur-2xl border border-white/70 ring-1 ring-emerald-200/40 " +
  "shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)] rounded-2xl";

// Секция внутри диалога — более прозрачная, чтобы фон диалога ощущался.
export const TASK_DIALOG_SECTION =
  "rounded-xl bg-white/45 backdrop-blur-md border border-white/60 p-3 space-y-3 " +
  "shadow-[0_2px_10px_-6px_rgba(15,23,42,0.08)]";

// CTA Save — пастельный emerald glass.
export const TASK_DIALOG_SAVE_CTA =
  "bg-emerald-100/70 text-emerald-800 border border-emerald-200/70 " +
  "hover:bg-emerald-200/70 backdrop-blur-sm shadow-sm";

// CTA "Готово" — более насыщенный emerald, но всё ещё пастель.
export const TASK_DIALOG_DONE_CTA =
  "bg-emerald-200/70 text-emerald-900 border border-emerald-300/70 " +
  "hover:bg-emerald-300/70 backdrop-blur-sm shadow-sm";

// CTA "Отменить задачу" — пастельный rose.
export const TASK_DIALOG_CANCEL_CTA =
  "bg-rose-100/70 text-rose-800 border border-rose-200/70 " +
  "hover:bg-rose-200/70 backdrop-blur-sm shadow-sm";

// CTA "В работу" — пастельный amber.
export const TASK_DIALOG_INPROGRESS_CTA =
  "bg-amber-100/70 text-amber-800 border border-amber-200/70 " +
  "hover:bg-amber-200/70 backdrop-blur-sm shadow-sm";

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
