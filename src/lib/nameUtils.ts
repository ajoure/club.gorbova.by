/**
 * Централизованные утилиты для работы с именами контактов
 */

/**
 * Парсит полное имя в first_name + last_name
 * Поддерживает форматы: "Имя Фамилия", "ФАМИЛИЯ ИМЯ", "Фамилия Имя Отчество"
 */
export function parseFullName(fullName: string | null): { 
  firstName: string; 
  lastName: string;
} {
  if (!fullName?.trim()) return { firstName: "", lastName: "" };
  
  const parts = fullName.trim().split(/\s+/);
  
  // Если всё в UPPERCASE латиницей — формат банковской карты: LASTNAME FIRSTNAME
  const isCardFormat = /^[A-Z\s]+$/.test(fullName);
  
  if (isCardFormat && parts.length >= 2) {
    // Карточный формат: ZELIANKEVICH AKSANA → firstName=Aksana, lastName=Zeliankevich
    return {
      firstName: capitalize(parts[parts.length - 1]),
      lastName: parts.slice(0, -1).map(capitalize).join(" ")
    };
  }
  
  // Стандартный формат: Имя Фамилия
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  
  // Если первая часть — фамилия (кириллица, заканчивается на типичные суффиксы)
  // Формат: Иванов Иван Иванович → lastName=Иванов, firstName=Иван
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

/**
 * Форматирует имя для отображения как "Фамилия Имя"
 */
export function formatContactName(contact: { 
  first_name?: string | null; 
  last_name?: string | null; 
  full_name?: string | null;
}): string {
  if (contact.last_name && contact.first_name) {
    return `${contact.last_name} ${contact.first_name}`;
  }
  if (contact.last_name) return contact.last_name;
  if (contact.first_name) return contact.first_name;
  if (contact.full_name) return contact.full_name;
  return "—";
}

/**
 * Capitalize first letter, lowercase rest
 */
function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Regex для типичных суффиксов фамилий (кириллица)
 */
const SURNAME_SUFFIX_RE = /(?:ов|ова|ев|ева|ёв|ёва|ский|ская|ський|ська|енко|чук|вич|ич)$/i;

/**
 * Нормализация имени из GetCourse:
 * 1) Если есть отдельные first_name/last_name → SoT
 * 2) Иначе парсим full_name: дедуп токенов, эвристика порядка
 */
export function normalizeGCName(row: {
  first_name?: string;
  last_name?: string;
  full_name?: string;
}): { first_name: string; last_name: string; full_name: string } {
  const fn = row.first_name?.trim() || '';
  const ln = row.last_name?.trim() || '';

  // Если есть оба поля из отдельных колонок — SoT
  if (fn && ln) {
    return { first_name: fn, last_name: ln, full_name: `${fn} ${ln}` };
  }

  const raw = row.full_name?.trim() || fn || ln || '';
  if (!raw) return { first_name: '', last_name: '', full_name: '' };

  let tokens = raw.split(/\s+/);

  // Дедупликация повторяющихся токенов (case-insensitive)
  // "A B A" → "A B", "A A B" → "A B", "B A A" → "B A"
  if (tokens.length >= 3) {
    const seen = new Map<string, number>(); // lowercase → first index
    const dedupedIndices: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const key = tokens[i].toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, i);
        dedupedIndices.push(i);
      }
    }
    if (dedupedIndices.length < tokens.length) {
      tokens = dedupedIndices.map(i => tokens[i]);
    }
  }

  let firstName = '';
  let lastName = '';

  if (tokens.length === 1) {
    firstName = tokens[0];
    lastName = '';
  } else if (tokens.length === 2) {
    // Default RU: "Фамилия Имя" → last=t1, first=t2
    let t1 = tokens[0];
    let t2 = tokens[1];

    // Эвристика swap: если t2 выглядит как фамилия, а t1 нет → swap
    const t1IsSurname = SURNAME_SUFFIX_RE.test(t1);
    const t2IsSurname = SURNAME_SUFFIX_RE.test(t2);

    if (t2IsSurname && !t1IsSurname) {
      // "Ольга Шабанова" → first=Ольга, last=Шабанова (swap)
      firstName = t1;
      lastName = t2;
    } else {
      // Default: "Шабан Ольга" → last=Шабан, first=Ольга
      lastName = t1;
      firstName = t2;
    }
  } else {
    // 3+ tokens (after dedup): last=t1, first=t2
    lastName = tokens[0];
    firstName = tokens[1];
  }

  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return { first_name: firstName, last_name: lastName, full_name: fullName };
}
