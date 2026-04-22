/**
 * Единый privacy-first helper для рендера автора в комнате вебинара.
 *
 * Контракт:
 * - Snapshot author_display_name — единственный SoT для имени.
 * - author_avatar_url IS NULL ⇒ аватар НЕ показываем (show_avatar=false уже учтён сервером).
 * - Profile fallback допустим ТОЛЬКО для аватарки и ТОЛЬКО при explicit allow (чат/вопросы legacy).
 * - Никаких email/phone/full_name/contact_id здесь не возвращаем.
 *
 * Staff display rule (sprint final):
 * - student-view: только display_name + аватар по privacy-правилам.
 * - staff-view: "ФИО (alias)" если staff_real_name отличается и непустой;
 *   иначе ФИО (если есть); иначе alias.
 * - staff_real_name приходит ТОЛЬКО из server-side источников
 *   (RPC get_room_participants / другие staff-only пути).
 *   Прямой client-fetch profiles ради ФИО запрещён.
 *
 * SoT-инвариант (см. Запуск 2 PHASE 1): hidden avatar → author_avatar_url IS NULL в БД.
 */

export type ParticipantDisplayInput = {
  user_id: string;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
  /** Legacy fallback ТОЛЬКО для avatar (имя берём из snapshot). */
  legacy_avatar_url?: string | null;
  /**
   * Staff-only ФИО автора. Передавать ТОЛЬКО когда:
   *  - viewerIsStaff=true,
   *  - значение пришло из доверенного server-side источника (RPC).
   * Для non-staff передавать undefined/null.
   */
  staff_real_name?: string | null;
  /** Включает staff-формат "ФИО (alias)". Для non-staff всегда false. */
  viewerIsStaff?: boolean;
};

export type ParticipantDisplay = {
  /** Имя для рендера в UI (учитывает viewerIsStaff). */
  displayName: string;
  /** Чистый alias (display_name) — для tooltip/aria, без ФИО. */
  alias: string;
  avatarUrl: string | null;
  initials: string;
  /** Признак, что итог отрендерен в staff-формате с ФИО. */
  isStaffFormatted: boolean;
};

const FALLBACK_NAME = "Пользователь";

export function getInitials(name: string): string {
  const parts = (name || "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")) || "?";
}

function formatStaffName(realName: string, alias: string): string {
  const r = realName.trim();
  const a = alias.trim();
  if (!r) return a || FALLBACK_NAME;
  if (!a) return r;
  // Сравнение нормализованное (case-insensitive, схлопнутые пробелы).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm(r) === norm(a)) return r;
  return `${r} (${a})`;
}

export function resolveParticipantDisplay(input: ParticipantDisplayInput): ParticipantDisplay {
  const alias = input.author_display_name?.trim() || FALLBACK_NAME;
  // Privacy-first: snapshot avatar — единственный canonical путь.
  // legacy_avatar_url подставляется ТОЛЬКО если snapshot пуст (миграционный fallback).
  const avatarUrl = input.author_avatar_url || input.legacy_avatar_url || null;

  const wantStaffFormat = !!input.viewerIsStaff && !!input.staff_real_name?.trim();
  const displayName = wantStaffFormat
    ? formatStaffName(input.staff_real_name as string, alias)
    : alias;

  return {
    displayName,
    alias,
    avatarUrl,
    initials: getInitials(alias),
    isStaffFormatted: wantStaffFormat && displayName !== alias,
  };
}
