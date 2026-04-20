/**
 * Sprint 2 PATCH 2.7: единый Source of Truth для room lifecycle.
 * Все компоненты (admin list, edit card, room header, cabinet) обязаны
 * читать состояние комнаты только через этот helper.
 */

export type RoomState = "closed" | "opened" | "live" | "completed";
export type LifecycleAction = "open_room" | "start_live" | "complete_webinar";

export const ROOM_STATES: RoomState[] = ["closed", "opened", "live", "completed"];

export const roomStateLabels: Record<RoomState, string> = {
  closed: "Комната закрыта",
  opened: "Комната открыта",
  live: "Идёт эфир",
  completed: "Вебинар завершён",
};

export const roomStateShortLabels: Record<RoomState, string> = {
  closed: "Закрыта",
  opened: "Открыта",
  live: "В эфире",
  completed: "Завершён",
};

/** Tone для бейджа (привязан к семантическим токенам shadcn variants) */
export const roomStateBadgeVariant: Record<
  RoomState,
  "secondary" | "default" | "destructive" | "outline"
> = {
  closed: "outline",
  opened: "secondary",
  live: "destructive",
  completed: "outline",
};

/** Поведение терминального состояния — нужно UI, чтобы не показывать lifecycle-кнопки */
export function isTerminalRoomState(state: RoomState): boolean {
  return state === "completed";
}

/** Допустимый следующий action из текущего состояния (или null, если терминал) */
export function getNextAction(state: RoomState): LifecycleAction | null {
  switch (state) {
    case "closed":
      return "open_room";
    case "opened":
      return "start_live";
    case "live":
      return "complete_webinar";
    case "completed":
    default:
      return null;
  }
}

/** Можно ли перейти из from в to по матрице */
export function canTransition(from: RoomState, to: RoomState): boolean {
  return (
    (from === "closed" && to === "opened") ||
    (from === "opened" && to === "live") ||
    (from === "live" && to === "completed")
  );
}

/** Доступен ли конкретный action из текущего состояния */
export function canPerformAction(state: RoomState, action: LifecycleAction): boolean {
  return getNextAction(state) === action;
}

export const lifecycleActionLabels: Record<LifecycleAction, string> = {
  open_room: "Открыть комнату",
  start_live: "Начать вебинар",
  complete_webinar: "Завершить вебинар",
};

/** ViewModel для бейджа — единый mapper для всех точек UI */
export interface RoomStateBadgeVM {
  label: string;
  shortLabel: string;
  variant: "secondary" | "default" | "destructive" | "outline";
  isTerminal: boolean;
  pulse: boolean;
}

export function getRoomStateBadgeVM(state: RoomState): RoomStateBadgeVM {
  return {
    label: roomStateLabels[state],
    shortLabel: roomStateShortLabels[state],
    variant: roomStateBadgeVariant[state],
    isTerminal: isTerminalRoomState(state),
    pulse: state === "live",
  };
}

/** Безопасный парсер для значений из БД/edge-функций */
export function parseRoomState(value: unknown, fallback: RoomState = "closed"): RoomState {
  if (typeof value === "string" && (ROOM_STATES as string[]).includes(value)) {
    return value as RoomState;
  }
  return fallback;
}
