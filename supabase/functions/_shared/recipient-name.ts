/**
 * Безопасное извлечение имени получателя для обращения в уведомлениях.
 *
 * Правило: лучше НЕ обращаться по имени вообще, чем обратиться по фамилии.
 * Многие full_name записаны как "Фамилия Имя" или вовсе одна фамилия.
 *
 * SOT: используется во ВСЕХ клиентских уведомлениях (Telegram, email).
 *      Внутри шаблонов нельзя использовать profile.full_name напрямую и
 *      нельзя использовать full_name.split(' ')[0].
 */

export type RecipientProfile = {
  full_name?: string | null;
  first_name?: string | null;
} | null | undefined;

// Окончания, по которым с высокой вероятностью определяется русская/белорусская/украинская фамилия.
// Если слово оканчивается так — НЕ используем его как имя.
const SURNAME_ENDINGS = [
  // женские
  "ова", "ева", "ёва", "ина", "ына", "ская", "цкая", "ая",
  // мужские
  "ов", "ев", "ёв", "ин", "ын", "ский", "цкий", "ой", "ий",
  // украинские/белорусские
  "енко", "юк", "ук", "чук", "ич", "ыч",
];

const looksLikeSurname = (raw: string): boolean => {
  const s = raw.trim().toLowerCase();
  if (s.length < 3) return false;
  return SURNAME_ENDINGS.some((end) => s.endsWith(end));
};

const toTitleCase = (raw: string): string => {
  const s = raw.trim();
  if (!s) return s;
  // поддержка дефисных имён (Анна-Мария)
  return s
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
};

/**
 * Возвращает имя получателя для обращения, либо null если надёжно определить нельзя.
 */
export function extractFirstName(profile: RecipientProfile): string | null {
  if (!profile) return null;

  // 1) если в БД уже есть отдельное first_name — используем его (с лёгкой санитизацией).
  const fn = (profile.first_name ?? "").toString().trim();
  if (fn && fn.length <= 40 && !looksLikeSurname(fn)) {
    return toTitleCase(fn);
  }

  // 2) парсим full_name
  const full = (profile.full_name ?? "").toString().trim();
  if (!full) return null;

  const tokens = full
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\-]/gu, ""))
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return null;

  if (tokens.length === 1) {
    // Одно слово: если похоже на фамилию — НЕ обращаемся по имени.
    if (looksLikeSurname(tokens[0])) return null;
    if (tokens[0].length > 40) return null;
    return toTitleCase(tokens[0]);
  }

  // Несколько токенов: берём первый, не похожий на фамилию.
  for (const t of tokens) {
    if (!looksLikeSurname(t) && t.length <= 40) {
      return toTitleCase(t);
    }
  }
  return null;
}

/**
 * Префикс обращения для шаблона: "Имя, " либо "" если имя неизвестно.
 * Использование: `${greetPrefix(profile)}ваш доступ заканчивается...`
 */
export function greetPrefix(profile: RecipientProfile): string {
  const name = extractFirstName(profile);
  return name ? `${name}, ` : "";
}

/**
 * Суффикс к приветствию: ", Имя" либо "".
 * Использование: `Здравствуйте${greetSuffix(profile)}!`
 */
export function greetSuffix(profile: RecipientProfile): string {
  const name = extractFirstName(profile);
  return name ? `, ${name}` : "";
}
