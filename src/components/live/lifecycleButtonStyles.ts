/**
 * Shared glass-button styles for live/admin lifecycle surfaces.
 *
 * НЕ глобальный UI primitive — только для кнопок live/admin контекстов
 * (lifecycle, "Создать эфир", "Справка", "Пересоздать", "Отвязать"...).
 * Не использовать в других модулях — там стандартный `<Button>`.
 *
 * Visual: «матовое стекло» как Sonner-уведомления
 * (mem://ui/notifications/sonner-visual-standard) — мягкий tint фона +
 * backdrop-blur, без насыщенного fill.
 *
 * Контракт формы:
 *  - h-9 для всех вариантов
 *  - текстовые кнопки: min-w-[148px] (длинные лейблы не ломаются — wrap не ставим)
 *  - icon-only: переопределить min-w + добавить w-9 px-0
 */
export const LIFECYCLE_BUTTON_BASE =
  "inline-flex items-center justify-center h-9 min-w-[148px] gap-1.5 px-3 rounded-md text-sm font-medium " +
  "backdrop-blur-md border shadow-sm hover:shadow-md transition-all " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:pointer-events-none disabled:opacity-40 disabled:bg-white/30 disabled:border-white/30 disabled:shadow-none disabled:hover:shadow-none " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

export const LIFECYCLE_BUTTON_TONES = {
  /** Нейтральная (Открыть комнату): мягкий серо-белый стеклянный fill */
  neutral:
    "bg-white/60 hover:bg-white/80 border-white/40 text-foreground/85 [&_svg]:text-foreground/70",
  /** Primary (Начать вебинар): мягкий blue-tinted glass */
  primary:
    "bg-primary/15 hover:bg-primary/25 border-primary/25 text-primary [&_svg]:text-primary",
  /** Destructive (Завершить — admin таблица): мягкий red-tinted glass */
  destructive:
    "bg-destructive/12 hover:bg-destructive/20 border-destructive/25 text-destructive/85 [&_svg]:text-destructive/85",
  /** Destructive room: чуть плотнее, чтобы оставаться заметной на фоне комнаты */
  destructiveRoom:
    "bg-destructive/15 hover:bg-destructive/25 border-destructive/30 text-destructive/90 [&_svg]:text-destructive/90",
  /** Success («Создать эфир»): мягкий emerald-tinted glass */
  success:
    "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30 text-emerald-700 [&_svg]:text-emerald-700",
  /** Info («Справка», нейтральные служебные): тот же серо-белый glass */
  info:
    "bg-white/60 hover:bg-white/80 border-white/40 text-foreground/80 [&_svg]:text-foreground/70",
  /** Warning («Пересоздать», «Отвязать»): мягкий amber-tinted glass */
  warning:
    "bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30 text-amber-700 [&_svg]:text-amber-700",
} as const;

export type LifecycleButtonTone = keyof typeof LIFECYCLE_BUTTON_TONES;
