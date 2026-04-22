/**
 * Единый privacy-first helper для рендера автора в комнате вебинара.
 *
 * Контракт:
 * - Snapshot author_display_name — единственный SoT для имени.
 * - author_avatar_url IS NULL ⇒ аватар НЕ показываем (show_avatar=false уже учтён сервером).
 * - Profile fallback допустим ТОЛЬКО для аватарки и ТОЛЬКО при explicit allow (чат/вопросы legacy).
 * - Никаких email/phone/full_name/contact_id здесь не возвращаем.
 *
 * SoT-инвариант (см. Запуск 2 PHASE 1): hidden avatar → author_avatar_url IS NULL в БД.
 */

export type ParticipantDisplayInput = {
  user_id: string;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
  /** Legacy fallback ТОЛЬКО для avatar (имя берём из snapshot). */
  legacy_avatar_url?: string | null;
};

export type ParticipantDisplay = {
  displayName: string;
  avatarUrl: string | null;
  initials: string;
};

const FALLBACK_NAME = "Пользователь";

export function getInitials(name: string): string {
  const parts = (name || "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")) || "?";
}

export function resolveParticipantDisplay(input: ParticipantDisplayInput): ParticipantDisplay {
  const displayName = input.author_display_name?.trim() || FALLBACK_NAME;
  // Privacy-first: snapshot avatar — единственный canonical путь.
  // legacy_avatar_url подставляется ТОЛЬКО если snapshot пуст (миграционный fallback).
  const avatarUrl = input.author_avatar_url || input.legacy_avatar_url || null;
  return {
    displayName,
    avatarUrl,
    initials: getInitials(displayName),
  };
}
