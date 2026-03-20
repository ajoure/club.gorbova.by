/**
 * OrgFormDictionary — canonical reference for CIS legal entity forms.
 *
 * Source of truth: fullName (stored in DB).
 * shortName is for display only.
 * aliases enable fuzzy search in combobox.
 */

export interface OrgFormEntry {
  fullName: string;
  shortName: string;
  country: string; // ISO 3166-1 alpha-2
  aliases: string[];
}

export const ORG_FORM_DICTIONARY: OrgFormEntry[] = [
  // Belarus
  { fullName: 'Общество с ограниченной ответственностью', shortName: 'ООО', country: 'BY', aliases: ['ооо', 'общество с огр'] },
  { fullName: 'Закрытое акционерное общество', shortName: 'ЗАО', country: 'BY', aliases: ['зао', 'закрытое акционерное'] },
  { fullName: 'Открытое акционерное общество', shortName: 'ОАО', country: 'BY', aliases: ['оао', 'открытое акционерное'] },
  { fullName: 'Общество с дополнительной ответственностью', shortName: 'ОДО', country: 'BY', aliases: ['одо', 'дополнительная ответственность'] },
  { fullName: 'Унитарное предприятие', shortName: 'УП', country: 'BY', aliases: ['уп', 'унитарное'] },
  { fullName: 'Коммунальное унитарное предприятие', shortName: 'КУП', country: 'BY', aliases: ['куп', 'коммунальное'] },
  { fullName: 'Частное унитарное предприятие', shortName: 'ЧУП', country: 'BY', aliases: ['чуп', 'частное унитарное'] },
  { fullName: 'Государственное унитарное предприятие', shortName: 'ГУП', country: 'BY', aliases: ['гуп', 'государственное унитарное'] },
  { fullName: 'Республиканское унитарное предприятие', shortName: 'РУП', country: 'BY', aliases: ['руп', 'республиканское'] },
  { fullName: 'Производственный кооператив', shortName: 'ПК', country: 'BY', aliases: ['пк', 'кооператив'] },
  { fullName: 'Совместное общество с ограниченной ответственностью', shortName: 'СООО', country: 'BY', aliases: ['сооо', 'совместное общество'] },
  { fullName: 'Иностранное общество с ограниченной ответственностью', shortName: 'ИООО', country: 'BY', aliases: ['иооо', 'иностранное общество'] },
  { fullName: 'Совместное закрытое акционерное общество', shortName: 'СЗАО', country: 'BY', aliases: ['сзао', 'совместное закрытое'] },
  { fullName: 'Иностранное унитарное предприятие', shortName: 'ИУП', country: 'BY', aliases: ['иуп', 'иностранное унитарное'] },
  { fullName: 'Частное производственное унитарное предприятие', shortName: 'ЧПУП', country: 'BY', aliases: ['чпуп', 'частное производственное'] },
  { fullName: 'Частное торговое унитарное предприятие', shortName: 'ЧТУП', country: 'BY', aliases: ['чтуп', 'частное торговое'] },
  { fullName: 'Индивидуальный предприниматель', shortName: 'ИП', country: 'BY', aliases: ['ип', 'индивидуальный предприниматель'] },
  // Russia (основные)
  { fullName: 'Общество с ограниченной ответственностью', shortName: 'ООО', country: 'RU', aliases: ['ооо'] },
  { fullName: 'Акционерное общество', shortName: 'АО', country: 'RU', aliases: ['ао', 'акционерное'] },
  { fullName: 'Публичное акционерное общество', shortName: 'ПАО', country: 'RU', aliases: ['пао', 'публичное'] },
  { fullName: 'Индивидуальный предприниматель', shortName: 'ИП', country: 'RU', aliases: ['ип'] },
  // Kazakhstan (основные)
  { fullName: 'Товарищество с ограниченной ответственностью', shortName: 'ТОО', country: 'KZ', aliases: ['тоо', 'товарищество'] },
  { fullName: 'Акционерное общество', shortName: 'АО', country: 'KZ', aliases: ['ао'] },
  { fullName: 'Индивидуальный предприниматель', shortName: 'ИП', country: 'KZ', aliases: ['ип'] },
];

/**
 * Search the dictionary by query string (matches fullName, shortName, aliases).
 * Optional country filter.
 */
export function searchOrgForms(query: string, country?: string): OrgFormEntry[] {
  const q = query.toLowerCase().trim();
  let entries = ORG_FORM_DICTIONARY;

  if (country) {
    entries = entries.filter(e => e.country === country);
  }

  // Remove duplicates by fullName (cross-country)
  const seen = new Set<string>();
  entries = entries.filter(e => {
    if (seen.has(e.fullName)) return false;
    seen.add(e.fullName);
    return true;
  });

  if (!q) return entries;

  return entries.filter(e =>
    e.fullName.toLowerCase().includes(q) ||
    e.shortName.toLowerCase().includes(q) ||
    e.aliases.some(a => a.includes(q))
  );
}

/**
 * Find entry by fullName (canonical lookup).
 */
export function findOrgFormByFull(fullName: string): OrgFormEntry | undefined {
  return ORG_FORM_DICTIONARY.find(e => e.fullName === fullName);
}

/**
 * Find entry by shortName.
 */
export function findOrgFormByShort(shortName: string): OrgFormEntry | undefined {
  return ORG_FORM_DICTIONARY.find(e => e.shortName === shortName);
}

/**
 * Get short name from full canonical form.
 */
export function getShortOrgForm(fullName: string): string {
  const entry = findOrgFormByFull(fullName);
  return entry?.shortName || fullName;
}
