/**
 * Webinar Room Settings — типы и merge-safe утилиты
 *
 * SoT: live_events.metadata.room_settings
 *
 * Privacy-инварианты (PHASE 1):
 * - prefs (display_name/nickname_color/show_avatar) хранятся в live_event_participant_prefs
 * - snapshot имени/аватара/цвета пишется триггером в live_event_comments / live_event_questions
 * - hidden avatar (show_avatar=false) -> author_avatar_url = NULL
 * - reserved_colors блокируются серверным триггером validate_nickname_color
 */

export type RoomGalleryItem = {
  url: string;
  caption?: string;
};

export type RoomPrestartSettings = {
  enabled: boolean;
  title?: string;
  cover_url?: string;
  timer_enabled: boolean;
  music_url?: string;
  gallery: RoomGalleryItem[];
};

export type RoomParticipantsSettings = {
  visible_for_students: boolean;
};

export type RoomEntrySettings = {
  name_required: boolean;
  color_required: boolean;
  avatar_toggle_enabled: boolean;
  allowed_colors: string[];
  staff_reserved_colors: string[];
  display_name_max_length: number;
};

export type RoomChatSettings = {
  emoji_normalization_enabled: boolean;
};

export type RoomReactionsSettings = {
  enabled: boolean;
  rate_limit_per_min: number;
};

export type RoomSettings = {
  prestart: RoomPrestartSettings;
  participants: RoomParticipantsSettings;
  entry: RoomEntrySettings;
  chat: RoomChatSettings;
  reactions: RoomReactionsSettings;
};

export const DEFAULT_ALLOWED_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#ef4444", // red — staff-reserved
];

export const DEFAULT_STAFF_RESERVED_COLORS = ["#ef4444"];

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  prestart: {
    enabled: false,
    title: "",
    cover_url: "",
    timer_enabled: true,
    music_url: "",
    gallery: [],
  },
  participants: {
    visible_for_students: true,
  },
  entry: {
    name_required: true,
    color_required: false,
    avatar_toggle_enabled: true,
    allowed_colors: DEFAULT_ALLOWED_COLORS,
    staff_reserved_colors: DEFAULT_STAFF_RESERVED_COLORS,
    display_name_max_length: 32,
  },
  chat: {
    emoji_normalization_enabled: true,
  },
  reactions: {
    enabled: true,
    rate_limit_per_min: 10,
  },
};

/**
 * Безопасное чтение room_settings из metadata: deep-merge с дефолтами
 * (соседние ветки metadata не трогаем).
 */
export function readRoomSettings(metadata: unknown): RoomSettings {
  const meta = (metadata && typeof metadata === "object" ? (metadata as Record<string, any>) : {});
  const stored = (meta.room_settings && typeof meta.room_settings === "object")
    ? (meta.room_settings as Record<string, any>)
    : {};

  return {
    prestart: { ...DEFAULT_ROOM_SETTINGS.prestart, ...(stored.prestart || {}),
      gallery: Array.isArray(stored.prestart?.gallery) ? stored.prestart.gallery : [] },
    participants: { ...DEFAULT_ROOM_SETTINGS.participants, ...(stored.participants || {}) },
    entry: { ...DEFAULT_ROOM_SETTINGS.entry, ...(stored.entry || {}),
      allowed_colors: Array.isArray(stored.entry?.allowed_colors) && stored.entry.allowed_colors.length
        ? stored.entry.allowed_colors
        : DEFAULT_ROOM_SETTINGS.entry.allowed_colors,
      staff_reserved_colors: Array.isArray(stored.entry?.staff_reserved_colors)
        ? stored.entry.staff_reserved_colors
        : DEFAULT_ROOM_SETTINGS.entry.staff_reserved_colors },
    chat: { ...DEFAULT_ROOM_SETTINGS.chat, ...(stored.chat || {}) },
    reactions: { ...DEFAULT_ROOM_SETTINGS.reactions, ...(stored.reactions || {}) },
  };
}

/**
 * Merge-safe запись: возвращает новый metadata с обновлённой ровно одной веткой room_settings,
 * не трогая соседние ключи (provider, room_theme, autoweb и т.д.).
 *
 * Используем при UPDATE: { metadata: mergeRoomSettingsIntoMetadata(existing, next) }
 */
export function mergeRoomSettingsIntoMetadata(
  existingMetadata: unknown,
  nextRoomSettings: RoomSettings
): Record<string, any> {
  const existing = (existingMetadata && typeof existingMetadata === "object")
    ? (existingMetadata as Record<string, any>)
    : {};
  return {
    ...existing,
    room_settings: nextRoomSettings,
  };
}

/**
 * Частичный update одной секции (prestart / entry / participants / chat / reactions).
 * Не перетирает другие секции внутри room_settings.
 */
export function patchRoomSettingsSection<K extends keyof RoomSettings>(
  current: RoomSettings,
  section: K,
  patch: Partial<RoomSettings[K]>
): RoomSettings {
  return {
    ...current,
    [section]: { ...current[section], ...patch },
  } as RoomSettings;
}

/**
 * Клиентская валидация цвета: блокируем reserved для non-staff.
 * Серверный guard — триггер validate_nickname_color (источник истины).
 */
export function isColorAllowedForViewer(
  color: string,
  settings: RoomEntrySettings,
  isStaff: boolean
): boolean {
  if (!color) return false;
  if (!settings.allowed_colors.includes(color)) return false;
  if (!isStaff && settings.staff_reserved_colors.includes(color)) return false;
  return true;
}
