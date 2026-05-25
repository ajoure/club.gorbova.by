// ============================================================================
// ru-inflection.ts — Sprint 11 C5-B
// ----------------------------------------------------------------------------
// Безопасное склонение русских ФИО, должностей и осторожно — фраз с
// организационно-правовыми формами. Если хотя бы одно кириллическое слово
// не распознано, склонение НЕ применяется — возвращается исходная строка
// с applied=false. Это защищает от искажений (например, ООО "АЖУР инкам").
// ============================================================================

export type RuCase =
  | 'nominative' | 'genitive' | 'dative'
  | 'accusative' | 'instrumental' | 'prepositional';

export interface InflectionResult {
  value: string;
  applied: boolean;        // безопасно ли склонено
  reason?: string;         // если !applied — почему
  per_token?: Array<{ in: string; out: string; rule: string }>;
}

const ABBREV = new Set([
  'ООО','ЗАО','ОДО','ИП','АО','ПАО','ОАО','ТОО','НКО','СП','ЧП','КФХ',
  'ИЧП','УП','РУП','ГУП','ФЛП','СПД','ОЮЛ','ЧУП','ОДО','НПФ','ФГУП','МУП',
]);

const isCyrWord = (s: string) => /^[А-Яа-яЁё-]+$/.test(s);
const isAllUpperCyr = (s: string) => /^[А-ЯЁ]{2,}$/.test(s);
const isLatin = (s: string) => /^[A-Za-z][A-Za-z0-9-]*$/.test(s);
const isQuote = (ch: string) => ch === '"' || ch === '«' || ch === '»' || ch === '“' || ch === '”';
const closing = (ch: string) => ch === '"' ? '"' : ch === '«' ? '»' : ch === '“' ? '”' : ch;

interface TokRes { word: string; rule: string; ok: 'inflected' | 'kept' | 'unknown'; }

// ── Должности / общеупотребимые слова (минимальный словарь) ────────────────
const JOB_NOUNS_M = new Set([
  'директор','менеджер','бухгалтер','предприниматель','представитель','специалист',
  'юрист','инженер','администратор','координатор','куратор','начальник','заместитель',
  'руководитель','исполнитель','заказчик','клиент','покупатель','продавец','учредитель',
  'основатель','владелец','собственник','подписант','секретарь',
]);
const JOB_ADJ_M = new Set([
  'генеральный','исполнительный','коммерческий','финансовый','технический','главный',
  'старший','младший','индивидуальный','временный','действующий','уполномоченный',
  'единственный','ответственный','полномочный','частный','государственный',
]);
// «управляющий», «ведущий» и подобные адъективные существительные на -щий/-ший/-чий
const isShchijAdj = (lc: string) => /(щий|ший|чий)$/.test(lc) && lc.length >= 5;

// ── Окончания падежей для разных морфо-классов ─────────────────────────────
// Возвращает суффикс, который надо подставить взамен исходного.

function inflectMaleSurnameOvEv(word: string, c: RuCase): string | null {
  // Иванов / Петров / Васильев / Пушкин / Лысын
  const lc = word.toLowerCase();
  if (!/(ов|ев|ёв|ин|ын)$/.test(lc)) return null;
  const stem = word; // прибавляем к полному
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'а';
    case 'dative':     return stem + 'у';
    case 'accusative': return stem + 'а';
    case 'instrumental': return stem + 'ым';
    case 'prepositional': return stem + 'е';
  }
}

function inflectFemaleSurnameOvaEva(word: string, c: RuCase): string | null {
  const lc = word.toLowerCase();
  if (!/(ова|ева|ёва|ина|ына)$/.test(lc)) return null;
  const stem = word.slice(0, -1); // отрезаем -а
  switch (c) {
    case 'nominative': return word;
    case 'genitive':
    case 'dative':
    case 'instrumental':
    case 'prepositional': return stem + 'ой';
    case 'accusative': return stem + 'у';
  }
}

function inflectMaleAdjSurname(word: string, c: RuCase): string | null {
  // Достоевский / Маяковский / Цуцкий
  const lc = word.toLowerCase();
  if (!/(ский|цкий|ской|цкой)$/.test(lc)) return null;
  const stem = word.slice(0, -2); // -ий → drop
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'ого';
    case 'dative':     return stem + 'ому';
    case 'accusative': return stem + 'ого';
    case 'instrumental': return stem + 'им';
    case 'prepositional': return stem + 'ом';
  }
}

function inflectFemaleAdjSurname(word: string, c: RuCase): string | null {
  const lc = word.toLowerCase();
  if (!/(ская|цкая)$/.test(lc)) return null;
  const stem = word.slice(0, -2);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':
    case 'dative':
    case 'instrumental':
    case 'prepositional': return stem + 'ой';
    case 'accusative': return stem + 'ую';
  }
}

function inflectPatronymicM(word: string, c: RuCase): string | null {
  const lc = word.toLowerCase();
  if (!/(ович|евич|ьич|ич)$/.test(lc)) return null;
  if (!/[аеёийоуыэюя]/i.test(lc)) return null;
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return word + 'а';
    case 'dative':     return word + 'у';
    case 'accusative': return word + 'а';
    case 'instrumental': return word + 'ем';
    case 'prepositional': return word + 'е';
  }
}

function inflectPatronymicF(word: string, c: RuCase): string | null {
  const lc = word.toLowerCase();
  if (!/(овна|евна|ична|инична)$/.test(lc)) return null;
  const stem = word.slice(0, -1); // отрезаем -а
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'ы';
    case 'dative':     return stem + 'е';
    case 'accusative': return stem + 'у';
    case 'instrumental': return stem + 'ой';
    case 'prepositional': return stem + 'е';
  }
}

function inflectMaleNameSoft(word: string, c: RuCase): string | null {
  // -й (Сергей, Николай, Алексей)
  const lc = word.toLowerCase();
  if (!/й$/.test(lc)) return null;
  const stem = word.slice(0, -1);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'я';
    case 'dative':     return stem + 'ю';
    case 'accusative': return stem + 'я';
    case 'instrumental': return stem + 'ем';
    case 'prepositional': return stem + 'е';
  }
}

function inflectMaleAdjNoun(word: string, c: RuCase): string | null {
  // -ый/-ий/-ой адъективные (директор? нет; управляющий — да)
  const lc = word.toLowerCase();
  if (isShchijAdj(lc)) {
    const stem = word.slice(0, -2);
    switch (c) {
      case 'nominative': return word;
      case 'genitive':   return stem + 'его';
      case 'dative':     return stem + 'ему';
      case 'accusative': return stem + 'его';
      case 'instrumental': return stem + 'им';
      case 'prepositional': return stem + 'ем';
    }
  }
  return null;
}

function inflectAdjMHard(word: string, c: RuCase): string | null {
  const lc = word.toLowerCase();
  if (!/(ый|ий|ой)$/.test(lc)) return null;
  // исключаем -ший/-щий/-чий (обработаны выше)
  if (isShchijAdj(lc)) return null;
  const stem = word.slice(0, -2);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'ого';
    case 'dative':     return stem + 'ому';
    case 'accusative': return stem + 'ого';
    case 'instrumental': return stem + 'ым';
    case 'prepositional': return stem + 'ом';
  }
}

function inflectMaleSoftNoun(word: string, c: RuCase): string | null {
  // мягкая основа на -ь (предприниматель, учитель, руководитель)
  if (!/ь$/.test(word.toLowerCase())) return null;
  const stem = word.slice(0, -1);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'я';
    case 'dative':     return stem + 'ю';
    case 'accusative': return stem + 'я';
    case 'instrumental': return stem + 'ем';
    case 'prepositional': return stem + 'е';
  }
}

function inflectMaleHardNoun(word: string, c: RuCase): string | null {
  // оканчивается на согласную
  const lc = word.toLowerCase();
  if (!/[бвгджзйклмнпрстфхцчшщ]$/.test(lc)) return null;
  if (/й$/.test(lc)) return null;
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return word + 'а';
    case 'dative':     return word + 'у';
    case 'accusative': return word + 'а';
    case 'instrumental': return word + 'ом';
    case 'prepositional': return word + 'е';
  }
}

function inflectFemNounA(word: string, c: RuCase): string | null {
  // -а (Анна, Мария? нет — -ия). Здесь только -а: Анна, Ольга, Елена.
  const lc = word.toLowerCase();
  if (!/[бвгдзклмнпрстфхц]а$/.test(lc)) return null;
  const stem = word.slice(0, -1);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'ы';
    case 'dative':     return stem + 'е';
    case 'accusative': return stem + 'у';
    case 'instrumental': return stem + 'ой';
    case 'prepositional': return stem + 'е';
  }
}

function inflectFemNounYa(word: string, c: RuCase): string | null {
  // -ия (Мария, Юлия, Дарья — Дарья = -ья тоже подходит)
  const lc = word.toLowerCase();
  if (!/(ия|ья)$/.test(lc)) return null;
  const stem = word.slice(0, -1);
  switch (c) {
    case 'nominative': return word;
    case 'genitive':   return stem + 'и';
    case 'dative':     return stem + 'е';
    case 'accusative': return stem + 'ю';
    case 'instrumental': return stem + 'ей';
    case 'prepositional': return stem + 'е';
  }
}

// Эвристика: «пол» по контексту (для сурнамов на согласную).
// Если уже видели маркер f (отчество/фамилия с -ова/-ская) → female.
// Иначе — male по умолчанию (для рабочих документов это безопаснее).
type Hint = 'm' | 'f' | null;

function inflectOneToken(
  raw: string, c: RuCase, hint: Hint,
): { out: string; rule: string; ok: TokRes['ok']; femHint?: Hint } {
  if (raw.length === 0) return { out: raw, rule: 'empty', ok: 'kept' };
  if (ABBREV.has(raw)) return { out: raw, rule: 'abbrev', ok: 'kept' };
  if (isAllUpperCyr(raw)) return { out: raw, rule: 'all_caps_kept', ok: 'kept' };
  if (isLatin(raw)) return { out: raw, rule: 'latin_kept', ok: 'kept' };
  if (!isCyrWord(raw)) return { out: raw, rule: 'non_cyr_kept', ok: 'kept' };

  const lc = raw.toLowerCase();
  // Чисто служебные слова — не склоняем (если будут встречаться)
  if (lc === 'и' || lc === 'или' || lc === 'в' || lc === 'на' || lc === 'по') {
    return { out: raw, rule: 'stopword', ok: 'kept' };
  }

  // Должности — словарь м.р.
  if (JOB_NOUNS_M.has(lc)) {
    const r =
      inflectMaleSoftNoun(raw, c) ?? inflectMaleHardNoun(raw, c);
    if (r) return { out: r, rule: 'job_noun_m', ok: 'inflected' };
  }
  if (JOB_ADJ_M.has(lc)) {
    const r = inflectAdjMHard(raw, c);
    if (r) return { out: r, rule: 'job_adj_m', ok: 'inflected' };
  }

  // Женские маркеры — фиксируем hint
  let femSet: Hint = null;
  let r: string | null = null;

  if ((r = inflectPatronymicF(raw, c))) { femSet = 'f'; return { out: r, rule: 'patronymic_f', ok: 'inflected', femHint: femSet }; }
  if ((r = inflectFemaleSurnameOvaEva(raw, c))) { femSet = 'f'; return { out: r, rule: 'surname_f_ova', ok: 'inflected', femHint: femSet }; }
  if ((r = inflectFemaleAdjSurname(raw, c))) { femSet = 'f'; return { out: r, rule: 'surname_f_adj', ok: 'inflected', femHint: femSet }; }

  if ((r = inflectPatronymicM(raw, c))) return { out: r, rule: 'patronymic_m', ok: 'inflected' };
  if ((r = inflectMaleSurnameOvEv(raw, c))) return { out: r, rule: 'surname_m_ov', ok: 'inflected' };
  if ((r = inflectMaleAdjSurname(raw, c))) return { out: r, rule: 'surname_m_adj', ok: 'inflected' };
  if ((r = inflectMaleNameSoft(raw, c))) return { out: r, rule: 'name_m_soft', ok: 'inflected' };
  if ((r = inflectMaleAdjNoun(raw, c))) return { out: r, rule: 'adj_noun_m_shchij', ok: 'inflected' };
  if ((r = inflectAdjMHard(raw, c))) return { out: r, rule: 'adj_m_hard', ok: 'inflected' };
  if ((r = inflectMaleSoftNoun(raw, c))) return { out: r, rule: 'noun_m_soft', ok: 'inflected' };

  // Если намекнули на f — попробуем женские правила для общих окончаний
  if (hint === 'f') {
    if ((r = inflectFemNounYa(raw, c))) return { out: r, rule: 'noun_f_ya', ok: 'inflected' };
    if ((r = inflectFemNounA(raw, c))) return { out: r, rule: 'noun_f_a', ok: 'inflected' };
  }

  if ((r = inflectMaleHardNoun(raw, c))) return { out: r, rule: 'noun_m_hard', ok: 'inflected' };

  // Кириллица, но правил не нашли → блокируем всё склонение
  return { out: raw, rule: 'unknown_cyr', ok: 'unknown' };
}

// ── Токенизатор: сохраняет пробелы, пунктуацию и кавычки ───────────────────
interface Span { kind: 'word' | 'sep' | 'quoted' | 'paren'; text: string; }

function tokenize(s: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isQuote(ch)) {
      const close = closing(ch);
      let j = i + 1;
      while (j < s.length && s[j] !== close) j++;
      const end = j < s.length ? j + 1 : j;
      out.push({ kind: 'quoted', text: s.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '(' ) {
      let j = i + 1;
      while (j < s.length && s[j] !== ')') j++;
      const end = j < s.length ? j + 1 : j;
      out.push({ kind: 'paren', text: s.slice(i, end) });
      i = end;
      continue;
    }
    if (/[А-Яа-яЁёA-Za-z0-9-]/.test(ch)) {
      let j = i;
      while (j < s.length && /[А-Яа-яЁёA-Za-z0-9-]/.test(s[j])) j++;
      out.push({ kind: 'word', text: s.slice(i, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < s.length && !/[А-Яа-яЁёA-Za-z0-9"«»“”()-]/.test(s[j])) j++;
    if (j === i) j = i + 1;
    out.push({ kind: 'sep', text: s.slice(i, j) });
    i = j;
  }
  return out;
}

export function inflectRu(input: string, c: RuCase, opts?: { forceGender?: 'm' | 'f' }): InflectionResult {
  if (c === 'nominative' || !input || typeof input !== 'string') {
    return { value: input, applied: c === 'nominative' };
  }
  const spans = tokenize(input.trim());
  if (spans.length === 0) return { value: input, applied: false, reason: 'empty' };

  // Первый проход — определить hint по женским маркерам.
  // forceGender (используется для должности руководителя) полностью отключает
  // auto-detection: должность всегда склоняется по мужской парадигме, независимо
  // от пола ФИО в той же строке.
  let hint: Hint = null;
  if (opts?.forceGender) {
    hint = opts.forceGender;
  } else {
    for (const sp of spans) {
      if (sp.kind !== 'word') continue;
      const lc = sp.text.toLowerCase();
      if (/(овна|евна|ична|инична)$/.test(lc)) { hint = 'f'; break; }
      if (/(ова|ева|ёва|ина|ына|ская|цкая)$/.test(lc)) { hint = 'f'; break; }
    }
  }

  const per: Array<{ in: string; out: string; rule: string }> = [];
  const result: string[] = [];
  let inflectedAny = false;
  let unknownAny = false;

  for (const sp of spans) {
    if (sp.kind === 'sep') { result.push(sp.text); continue; }
    if (sp.kind === 'quoted' || sp.kind === 'paren') {
      result.push(sp.text);
      per.push({ in: sp.text, out: sp.text, rule: 'kept_inside_brackets' });
      continue;
    }
    const r = inflectOneToken(sp.text, c, hint);
    // forceGender='m' — игнорируем femHint, чтобы должность не «съезжала» в ж.р.
    if (r.femHint && !opts?.forceGender) hint = r.femHint;
    result.push(r.out);
    per.push({ in: sp.text, out: r.out, rule: r.rule });
    if (r.ok === 'inflected') inflectedAny = true;
    if (r.ok === 'unknown') unknownAny = true;
  }

  if (unknownAny || !inflectedAny) {
    return {
      value: input,
      applied: false,
      reason: unknownAny ? 'unknown_cyrillic_token' : 'no_inflectable_token',
      per_token: per,
    };
  }
  return { value: result.join(''), applied: true, per_token: per };
}

// ───────────────────────────────────────────────────────────────────────────
// Канонический словарь форм собственности short ↔ long.
// Используется FLD-резолвером для модификатора `format=long` на поле
// `*.leg.org_form` и для склейки `*.leg.short_name = ${org_form} «${name}»`.
// ───────────────────────────────────────────────────────────────────────────
export const ORG_FORM_SHORT_TO_FULL: Record<string, string> = {
  'ООО':  'Общество с ограниченной ответственностью',
  'ОДО':  'Общество с дополнительной ответственностью',
  'ЗАО':  'Закрытое акционерное общество',
  'ОАО':  'Открытое акционерное общество',
  'АО':   'Акционерное общество',
  'ПАО':  'Публичное акционерное общество',
  'ИП':   'Индивидуальный предприниматель',
  'УП':   'Унитарное предприятие',
  'ЧУП':  'Частное унитарное предприятие',
  'ПУП':  'Производственное унитарное предприятие',
  'РУП':  'Республиканское унитарное предприятие',
  'ГУП':  'Государственное унитарное предприятие',
  'ФГУП': 'Федеральное государственное унитарное предприятие',
  'МУП':  'Муниципальное унитарное предприятие',
  'ГП':   'Государственное предприятие',
  'КП':   'Коммунальное предприятие',
  'ТДО':  'Товарищество с дополнительной ответственностью',
  'ТОО':  'Товарищество с ограниченной ответственностью',
  'СООО': 'Совместное общество с ограниченной ответственностью',
  'ИООО': 'Иностранное общество с ограниченной ответственностью',
  'ИЧУП': 'Иностранное частное унитарное предприятие',
  'СП':   'Совместное предприятие',
};

// Reverse map (full lowercase → short). Используется canonicalizeLegalEntity
// для распознавания полной формы собственности в начале сырого имени.
export const ORG_FORM_FULL_TO_SHORT: Record<string, string> = Object.entries(
  ORG_FORM_SHORT_TO_FULL,
).reduce((acc, [short, full]) => {
  acc[full.toLowerCase()] = short;
  return acc;
}, {} as Record<string, string>);

export function expandOrgFormToLong(short: string | null | undefined): string {
  if (!short) return '';
  const key = String(short).trim().toUpperCase();
  return ORG_FORM_SHORT_TO_FULL[key] ?? String(short).trim();
}

// ===========================================================================
// normalizeMasculinePosition — приводит должность к мужскому роду ВСЕГДА,
// независимо от наличия case-модификатора. Применяется ДО inflectRu.
// Pipeline: raw → normalizeMasculinePosition → inflectRu(..., {forceGender:'m'}).
// Женская форма должности в документах не выводится.
// ===========================================================================
const FEM_TO_MASC_POSITION: Record<string, string> = {
  'управляющая':            'управляющий',
  'генеральная директриса': 'генеральный директор',
  'генеральная директорша': 'генеральный директор',
  'директриса':             'директор',
  'директорша':             'директор',
  'заместительница':        'заместитель',
  'руководительница':       'руководитель',
  'исполнительница':        'исполнитель',
  'учредительница':         'учредитель',
  'основательница':         'основатель',
  'владелица':              'владелец',
  'собственница':           'собственник',
  'продавщица':             'продавец',
  'покупательница':         'покупатель',
  'представительница':      'представитель',
  'специалистка':           'специалист',
  'юристка':                'юрист',
  'юрисконсультка':         'юрисконсульт',
  'консультантка':          'консультант',
  'бухгалтерша':            'бухгалтер',
  'администраторша':        'администратор',
  'менеджерша':             'менеджер',
  'координаторша':          'координатор',
  'кураторша':              'куратор',
  'начальница':             'начальник',
  'индивидуальная предпринимательница': 'индивидуальный предприниматель',
  'предпринимательница':    'предприниматель',
  'секретарша':             'секретарь',
  'председательница':       'председатель',
};

function preserveFirstCase(orig: string, repl: string): string {
  if (!orig) return repl;
  const first = orig.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return repl.charAt(0).toUpperCase() + repl.slice(1);
  }
  return repl;
}

export function normalizeMasculinePosition(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (!trimmed) return '';
  const lc = trimmed.toLowerCase();

  // 1) Точное / префиксное совпадение (длинные ключи первыми).
  const keys = Object.keys(FEM_TO_MASC_POSITION).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lc === k) return preserveFirstCase(trimmed, FEM_TO_MASC_POSITION[k]);
    if (lc.startsWith(k + ' ')) {
      return preserveFirstCase(trimmed, FEM_TO_MASC_POSITION[k]) + trimmed.slice(k.length);
    }
  }
  // 2) Замена внутри строки (на случай составных форм).
  let out = trimmed;
  for (const k of keys) {
    const re = new RegExp(`\\b${k}\\b`, 'giu');
    out = out.replace(re, (m) => preserveFirstCase(m, FEM_TO_MASC_POSITION[k]));
  }
  return out;
}

// ===========================================================================
// inflectCompanyName — добавлено в рамках спринта «морфология DOCX»
// ---------------------------------------------------------------------------
// Склоняет ТОЛЬКО префикс юрлица из словаря (организационно-правовая форма
// + родовое слово). Аббревиатуры (ООО/ЗАО/ИП/...) и название в кавычках
// не склоняются. Для «Индивидуальный предприниматель <ФИО>» хвост дополнительно
// прогоняется через inflectRu.
// ===========================================================================

type CaseMap = Record<RuCase, string>;

interface CompanyDictEntry {
  prefix: string;        // lowercase ключ для матча
  forms: CaseMap;        // 6 форм, всё в нижнем регистре
}

// Перечислены от длинных к коротким — first-match wins.
const COMPANY_DICT: CompanyDictEntry[] = [
  {
    prefix: 'закрытое акционерное общество',
    forms: {
      nominative:    'закрытое акционерное общество',
      genitive:      'закрытого акционерного общества',
      dative:        'закрытому акционерному обществу',
      accusative:    'закрытое акционерное общество',
      instrumental:  'закрытым акционерным обществом',
      prepositional: 'закрытом акционерном обществе',
    },
  },
  {
    prefix: 'открытое акционерное общество',
    forms: {
      nominative:    'открытое акционерное общество',
      genitive:      'открытого акционерного общества',
      dative:        'открытому акционерному обществу',
      accusative:    'открытое акционерное общество',
      instrumental:  'открытым акционерным обществом',
      prepositional: 'открытом акционерном обществе',
    },
  },
  {
    prefix: 'общество с ограниченной ответственностью',
    forms: {
      nominative:    'общество с ограниченной ответственностью',
      genitive:      'общества с ограниченной ответственностью',
      dative:        'обществу с ограниченной ответственностью',
      accusative:    'общество с ограниченной ответственностью',
      instrumental:  'обществом с ограниченной ответственностью',
      prepositional: 'обществе с ограниченной ответственностью',
    },
  },
  {
    prefix: 'общество с дополнительной ответственностью',
    forms: {
      nominative:    'общество с дополнительной ответственностью',
      genitive:      'общества с дополнительной ответственностью',
      dative:        'обществу с дополнительной ответственностью',
      accusative:    'общество с дополнительной ответственностью',
      instrumental:  'обществом с дополнительной ответственностью',
      prepositional: 'обществе с дополнительной ответственностью',
    },
  },
  {
    prefix: 'акционерное общество',
    forms: {
      nominative:    'акционерное общество',
      genitive:      'акционерного общества',
      dative:        'акционерному обществу',
      accusative:    'акционерное общество',
      instrumental:  'акционерным обществом',
      prepositional: 'акционерном обществе',
    },
  },
  {
    prefix: 'индивидуальный предприниматель',
    forms: {
      nominative:    'индивидуальный предприниматель',
      genitive:      'индивидуального предпринимателя',
      dative:        'индивидуальному предпринимателю',
      accusative:    'индивидуального предпринимателя',
      instrumental:  'индивидуальным предпринимателем',
      prepositional: 'индивидуальном предпринимателе',
    },
  },
  {
    prefix: 'частное унитарное предприятие',
    forms: {
      nominative:    'частное унитарное предприятие',
      genitive:      'частного унитарного предприятия',
      dative:        'частному унитарному предприятию',
      accusative:    'частное унитарное предприятие',
      instrumental:  'частным унитарным предприятием',
      prepositional: 'частном унитарном предприятии',
    },
  },
  {
    prefix: 'унитарное предприятие',
    forms: {
      nominative:    'унитарное предприятие',
      genitive:      'унитарного предприятия',
      dative:        'унитарному предприятию',
      accusative:    'унитарное предприятие',
      instrumental:  'унитарным предприятием',
      prepositional: 'унитарном предприятии',
    },
  },
  {
    prefix: 'совместное предприятие',
    forms: {
      nominative:    'совместное предприятие',
      genitive:      'совместного предприятия',
      dative:        'совместному предприятию',
      accusative:    'совместное предприятие',
      instrumental:  'совместным предприятием',
      prepositional: 'совместном предприятии',
    },
  },
];

const COMPANY_ABBREV_RE =
  /^\s*(ООО|ЗАО|ОАО|ПАО|АО|ОДО|ИП|УП|РУП|ЧУП|ГУП|ФГУП|МУП|ТОО|НКО|СП|ЧП|КФХ|ИЧП|ФЛП|СПД|ОЮЛ|НПФ)(\s|$|\.|"|«|“)/;

function matchCase(template: string, sample: string): string {
  // Если первый символ sample заглавный — поднять регистр первого символа template.
  if (!sample || !template) return template;
  const first = sample.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return template.charAt(0).toUpperCase() + template.slice(1);
  }
  return template;
}

export interface CompanyInflectionResult {
  value: string;
  applied: boolean;
  reason?: string;
  prefix_matched?: string | null;
  tail_inflection?: InflectionResult | null;
}

export function inflectCompanyName(input: string, c: RuCase): CompanyInflectionResult {
  if (!input || typeof input !== 'string') {
    return { value: input, applied: false, reason: 'empty' };
  }
  if (c === 'nominative') {
    return { value: input, applied: true, prefix_matched: null };
  }

  const trimmed = input.trim();
  if (COMPANY_ABBREV_RE.test(trimmed)) {
    return { value: input, applied: false, reason: 'abbreviation_not_inflected' };
  }

  const lower = trimmed.toLowerCase();
  let entry: CompanyDictEntry | null = null;
  for (const e of COMPANY_DICT) {
    if (lower.startsWith(e.prefix)) { entry = e; break; }
  }
  if (!entry) {
    return { value: input, applied: false, reason: 'no_known_legal_form' };
  }

  const prefixOriginal = trimmed.slice(0, entry.prefix.length);
  const tail = trimmed.slice(entry.prefix.length);
  const newPrefix = matchCase(entry.forms[c], prefixOriginal);

  // Special: «Индивидуальный предприниматель <ФИО>» — склонить хвост через inflectRu.
  let finalTail = tail;
  let tailInflection: InflectionResult | null = null;
  if (entry.prefix === 'индивидуальный предприниматель') {
    const tailTrim = tail.replace(/^\s+/, '');
    if (tailTrim.length > 0 && /^[А-ЯЁ]/.test(tailTrim)) {
      tailInflection = inflectRu(tailTrim, c);
      const leading = tail.slice(0, tail.length - tailTrim.length);
      finalTail = leading + (tailInflection.applied ? tailInflection.value : tailTrim);
    }
  }

  return {
    value: newPrefix + finalTail,
    applied: true,
    prefix_matched: entry.prefix,
    tail_inflection: tailInflection,
  };
}

