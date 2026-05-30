/**
 * personNameFormat — Sprint 3J-Roles (frontend UI helper).
 *
 * Единый стандарт форматирования ФИО для package roles ({{ln-XXXXXX}}),
 * package FIO полей (директор ЮЛ / ФИО ФЛ) и UI-preview каталога плейсхолдеров.
 *
 * Канон форматов (зеркало backend `_shared/typed-tokens-resolver.ts → formatPersonName`):
 *   full             → «Федорчук Сергей Валерьевич»
 *   short            → «Федорчук С.В.»     (БЕЗ пробела между инициалами)
 *   signature_short  → «С.В.Федорчук»      (БЕЗ пробелов вообще)
 *
 * Падеж (case) — минимальный rule-based inflector для типичных русских ФИО
 * (мужских и женских с -ова/-ева/-ина), достаточный для preview каталога.
 * Не претендует на полноту словарной библиотеки (`ru-inflection.ts` в backend).
 * Если правил не хватает (`reason !== null`) — возвращаем исходное ФИО без
 * пометки об ошибке; реальный generated DOCX склоняется через backend.
 */

export type PersonNameFormat = "full" | "short" | "signature_short";
export type PersonNameCase =
  | "nominative"
  | "genitive"
  | "dative"
  | "accusative"
  | "instrumental"
  | "prepositional";

export const PERSON_NAME_FORMAT_LABEL: Record<PersonNameFormat, string> = {
  full: "ФИО полностью",
  short: "ФИО кратко",
  signature_short: "ФИО для подписи",
};

interface FioParts {
  surname: string;
  first: string;
  patronymic: string;
}

function splitFio(full: string): FioParts {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return {
    surname: parts[0] ?? "",
    first: parts[1] ?? "",
    patronymic: parts[2] ?? "",
  };
}

/* ─────────────────────────── inflection rules ─────────────────────────── */

type CaseMap = Record<Exclude<PersonNameCase, "nominative">, string>;

/**
 * Заменить окончание `from` на `to`. Если слово не оканчивается на `from`,
 * вернуть само слово (без модификации).
 */
function replaceEnd(word: string, from: string, to: string): string {
  if (!word.toLowerCase().endsWith(from.toLowerCase())) return word;
  return word.slice(0, word.length - from.length) + to;
}

function appendEnd(word: string, end: string): string {
  return word + end;
}

/**
 * Определить женское ли ФИО по типовым окончаниям.
 * Хватает для preview: -ова/-ева/-ина/-ская + отчества -овна/-евна/-ична.
 */
function isFemale(p: FioParts): boolean {
  const s = p.surname.toLowerCase();
  if (/(ова|ева|ёва|ина|ына|ская|цкая)$/.test(s)) return true;
  const pat = p.patronymic.toLowerCase();
  if (/(овна|евна|ична|инична)$/.test(pat)) return true;
  return false;
}

/** Склонение мужской фамилии. */
function inflectSurnameM(word: string, c: PersonNameCase): string {
  if (c === "nominative") return word;
  const lc = word.toLowerCase();
  // -ов/-ев/-ёв/-ин/-ын: noun-adjective хвост
  if (/(ов|ев|ёв|ин|ын)$/.test(lc)) {
    const map: CaseMap = {
      genitive: "а", dative: "у", accusative: "а",
      instrumental: "ым", prepositional: "е",
    };
    return appendEnd(word, map[c]);
  }
  // -ский/-цкий: прилагательное
  if (/(ский|цкий)$/.test(lc)) {
    const map: CaseMap = {
      genitive: "ого", dative: "ому", accusative: "ого",
      instrumental: "им", prepositional: "ом",
    };
    return replaceEnd(word, "ий", map[c]);
  }
  // -й (Чайковский уже выше; -ой): редкий
  if (/й$/.test(lc)) {
    return replaceEnd(word, "й", { genitive: "я", dative: "ю", accusative: "я", instrumental: "ем", prepositional: "е" }[c]);
  }
  // -ь
  if (/ь$/.test(lc)) {
    return replaceEnd(word, "ь", { genitive: "я", dative: "ю", accusative: "я", instrumental: "ем", prepositional: "е" }[c]);
  }
  // -а/-я (мужские типа Глоба, Скрипка): склоняются по ж.р.
  if (/[ая]$/.test(lc)) {
    return inflectFemNounA(word, c);
  }
  // На согласный (Федорчук, Бондарь, Гарбуз)
  const map: CaseMap = {
    genitive: "а", dative: "у", accusative: "а",
    instrumental: "ом", prepositional: "е",
  };
  return appendEnd(word, map[c]);
}

/** Склонение женской фамилии. */
function inflectSurnameF(word: string, c: PersonNameCase): string {
  if (c === "nominative") return word;
  const lc = word.toLowerCase();
  // -ова/-ева/-ёва/-ина/-ына: краткое прилагательное-фамилия
  if (/(ова|ева|ёва|ина|ына)$/.test(lc)) {
    const map: CaseMap = {
      genitive: "ой", dative: "ой", accusative: "у",
      instrumental: "ой", prepositional: "ой",
    };
    return replaceEnd(word, "а", map[c]);
  }
  // -ская/-цкая
  if (/(ская|цкая)$/.test(lc)) {
    const map: CaseMap = {
      genitive: "ой", dative: "ой", accusative: "ую",
      instrumental: "ой", prepositional: "ой",
    };
    return replaceEnd(word, "ая", map[c]);
  }
  // -а/-я общего типа
  if (/[ая]$/.test(lc)) {
    return inflectFemNounA(word, c);
  }
  // Несклоняемые (Корбут, Бондарь у женщин) — оставляем
  return word;
}

function inflectFemNounA(word: string, c: PersonNameCase): string {
  const lc = word.toLowerCase();
  if (/я$/.test(lc)) {
    return replaceEnd(word, "я", { genitive: "и", dative: "е", accusative: "ю", instrumental: "ей", prepositional: "е" }[c]);
  }
  // -а: дополнительно учтём после г/к/х/ж/ш/ч/щ для accusative нет особенностей
  return replaceEnd(word, "а", { genitive: "ы", dative: "е", accusative: "у", instrumental: "ой", prepositional: "е" }[c]);
}

/** Склонение мужского имени. */
function inflectFirstM(word: string, c: PersonNameCase): string {
  if (c === "nominative") return word;
  const lc = word.toLowerCase();
  // -й (Сергей, Андрей, Алексей, Николай)
  if (/й$/.test(lc)) {
    return replaceEnd(word, "й", { genitive: "я", dative: "ю", accusative: "я", instrumental: "ем", prepositional: "е" }[c]);
  }
  // -ь (Игорь)
  if (/ь$/.test(lc)) {
    return replaceEnd(word, "ь", { genitive: "я", dative: "ю", accusative: "я", instrumental: "ем", prepositional: "е" }[c]);
  }
  // -а/-я (Никита, Илья) — по ж.р. парадигме
  if (/[ая]$/.test(lc)) {
    return inflectFemNounA(word, c);
  }
  // На согласный (Иван, Пётр, Виктор)
  const map: CaseMap = {
    genitive: "а", dative: "у", accusative: "а",
    instrumental: "ом", prepositional: "е",
  };
  return appendEnd(word, map[c]);
}

/** Склонение женского имени. */
function inflectFirstF(word: string, c: PersonNameCase): string {
  if (c === "nominative") return word;
  const lc = word.toLowerCase();
  if (/ь$/.test(lc)) return word; // Любовь — нерегулярное, оставляем
  if (/[ая]$/.test(lc)) return inflectFemNounA(word, c);
  return word;
}

/** Склонение отчества (мужского). */
function inflectPatronymicM(word: string, c: PersonNameCase): string {
  if (c === "nominative" || !word) return word;
  // -ович/-евич/-ич (Иванович, Валерьевич, Ильич)
  if (/(ович|евич|ич)$/i.test(word)) {
    const map: CaseMap = {
      genitive: "а", dative: "у", accusative: "а",
      instrumental: "ем", prepositional: "е",
    };
    return appendEnd(word, map[c]);
  }
  return word;
}

/** Склонение отчества (женского). */
function inflectPatronymicF(word: string, c: PersonNameCase): string {
  if (c === "nominative" || !word) return word;
  // -овна/-евна/-ична/-инична
  if (/(овна|евна|ична|инична)$/i.test(word)) {
    return replaceEnd(word, "а", { genitive: "ы", dative: "е", accusative: "у", instrumental: "ой", prepositional: "е" }[c]);
  }
  return word;
}

/* ─────────────────────────── public API ─────────────────────────── */

export interface FormatPersonNameOptions {
  format?: PersonNameFormat;
  /** Падеж. Если не задан или `nominative` — без склонения. */
  case?: PersonNameCase | null;
}

/**
 * Отформатировать ФИО для preview / chip.
 *
 * Stable contract:
 *   formatPersonName("Иванов Иван Иванович", { format: "short" })
 *     → "Иванов И.И."
 *   formatPersonName("Иванов Иван Иванович", { format: "signature_short" })
 *     → "И.И.Иванов"
 *   formatPersonName("Федорчук Сергей Валерьевич", { format: "short", case: "genitive" })
 *     → "Федорчука С.В."
 *
 * Если ФИО состоит из одного токена — возвращается как есть.
 */
export function formatPersonName(
  fullName: string | null | undefined,
  options: FormatPersonNameOptions = {},
): string {
  if (!fullName) return "";
  const trimmed = String(fullName).trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const format: PersonNameFormat = options.format ?? "full";
  const caseMod: PersonNameCase | null = options.case ?? null;

  const parts = splitFio(trimmed);

  // Если меньше двух токенов — modifiers неприменимы, возвращаем как есть.
  if (!parts.surname || !parts.first) {
    return trimmed;
  }

  const female = isFemale(parts);

  // Склонение применяется к именным компонентам ДО форматирования инициалов.
  // Инициалы (одна буква) не склоняются — склоняется только фамилия.
  let surname = parts.surname;
  let first = parts.first;
  let patronymic = parts.patronymic;

  if (caseMod && caseMod !== "nominative") {
    surname = female
      ? inflectSurnameF(parts.surname, caseMod)
      : inflectSurnameM(parts.surname, caseMod);
    // Для short/signature_short первое имя/отчество превращаются в инициалы — их не склоняем.
    if (format === "full") {
      first = female
        ? inflectFirstF(parts.first, caseMod)
        : inflectFirstM(parts.first, caseMod);
      patronymic = female
        ? inflectPatronymicF(parts.patronymic, caseMod)
        : inflectPatronymicM(parts.patronymic, caseMod);
    }
  }

  const fInit = parts.first.charAt(0).toUpperCase();
  const pInit = parts.patronymic.charAt(0).toUpperCase();

  switch (format) {
    case "full":
      return [surname, first, patronymic].filter(Boolean).join(" ");
    case "short":
      // Фамилия И.О. — без пробела между инициалами.
      return parts.patronymic
        ? `${surname} ${fInit}.${pInit}.`
        : `${surname} ${fInit}.`;
    case "signature_short":
      // И.О.Фамилия — без пробелов вообще.
      return parts.patronymic
        ? `${fInit}.${pInit}.${surname}`
        : `${fInit}.${surname}`;
  }
}

/**
 * Демо-ФИО для UI-preview каталога. Используется когда реальное назначение
 * роли/поля недоступно. Соответствует пользовательскому канону DoD §3.
 */
export const DEMO_PERSON_NAME = "Федорчук Сергей Валерьевич";
