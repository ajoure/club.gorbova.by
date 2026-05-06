// ============================================================================
// docx-helpers.ts — Sprint 2 shared helpers (canonical document pipeline)
// ----------------------------------------------------------------------------
// Содержит:
//   • numberToWordsRu(amount, currency)   — сумма прописью на русском
//   • formatMoney(amount, currency)       — форматирование с пробелами/2 знаков
//   • normalizeCurrency(currency)         — нормализация валюты (BYN/PLN/USD/EUR)
//   • extractDocxTokensWithLocations(buf) — расширенный парсер DOCX
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import PizZip from 'npm:pizzip@3.1.6';

// ──────────────────────────── currency ─────────────────────────────────────

export type CurrencyCode = 'BYN' | 'PLN' | 'USD' | 'EUR' | 'RUB' | 'UNKNOWN';

const CURRENCY_ALIASES: Record<string, CurrencyCode> = {
  BYN: 'BYN', BYR: 'BYN', 'BLR': 'BYN', 'BEL': 'BYN',
  PLN: 'PLN', ZL: 'PLN', ZLOTY: 'PLN',
  USD: 'USD', US: 'USD', '$': 'USD',
  EUR: 'EUR', '€': 'EUR',
  RUB: 'RUB', RUR: 'RUB', '₽': 'RUB',
};

export function normalizeCurrency(input?: string | null): CurrencyCode {
  if (!input) return 'UNKNOWN';
  const v = String(input).trim().toUpperCase();
  return CURRENCY_ALIASES[v] || 'UNKNOWN';
}

interface CurrencyForms {
  // grammatical forms for major unit: [1, 2-4, 5+]
  major: [string, string, string];
  // gender of the major unit (used to inflect 1/2)
  majorGender: 'm' | 'f';
  // grammatical forms for minor unit (cents/kopecks/groszy)
  minor: [string, string, string];
  minorGender: 'm' | 'f';
}

const CURRENCY_FORMS: Record<Exclude<CurrencyCode, 'UNKNOWN'>, CurrencyForms> = {
  BYN: {
    major: ['белорусский рубль', 'белорусских рубля', 'белорусских рублей'],
    majorGender: 'm',
    minor: ['копейка', 'копейки', 'копеек'],
    minorGender: 'f',
  },
  PLN: {
    major: ['польский злотый', 'польских злотых', 'польских злотых'],
    majorGender: 'm',
    minor: ['грош', 'гроша', 'грошей'],
    minorGender: 'm',
  },
  USD: {
    major: ['доллар США', 'доллара США', 'долларов США'],
    majorGender: 'm',
    minor: ['цент', 'цента', 'центов'],
    minorGender: 'm',
  },
  EUR: {
    major: ['евро', 'евро', 'евро'],
    majorGender: 'm',
    minor: ['цент', 'цента', 'центов'],
    minorGender: 'm',
  },
  RUB: {
    major: ['российский рубль', 'российских рубля', 'российских рублей'],
    majorGender: 'm',
    minor: ['копейка', 'копейки', 'копеек'],
    minorGender: 'f',
  },
};

// ──────────────────────────── pluralization ────────────────────────────────

function pluralForm(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

// ──────────────────────────── number → words (RU) ──────────────────────────

const ONES_M = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять',
                'десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать',
                'шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const ONES_F = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять',
                'десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать',
                'шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const TENS = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const HUNDREDS = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];

function tripletToWords(num: number, gender: 'm' | 'f'): string {
  if (num === 0) return '';
  const ones = gender === 'f' ? ONES_F : ONES_M;
  const parts: string[] = [];
  const h = Math.floor(num / 100);
  const rest = num % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest < 20) {
    if (rest) parts.push(ones[rest]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    parts.push(TENS[t]);
    if (o) parts.push(ones[o]);
  }
  return parts.join(' ');
}

const THOUSAND_FORMS: [string, string, string] = ['тысяча','тысячи','тысяч'];
const MILLION_FORMS: [string, string, string] = ['миллион','миллиона','миллионов'];
const BILLION_FORMS: [string, string, string] = ['миллиард','миллиарда','миллиардов'];

/**
 * integerToWordsRu — целое число прописью с учётом рода для последней триады.
 */
export function integerToWordsRu(n: number, gender: 'm' | 'f' = 'm'): string {
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'ноль';
  const sign = n < 0 ? 'минус ' : '';
  let num = Math.abs(Math.trunc(n));
  const triplets: number[] = [];
  while (num > 0) { triplets.push(num % 1000); num = Math.floor(num / 1000); }
  const parts: string[] = [];
  for (let i = triplets.length - 1; i >= 0; i--) {
    const t = triplets[i];
    if (!t && i !== 0) continue;
    if (i === 0) {
      const w = tripletToWords(t, gender);
      if (w) parts.push(w);
    } else if (i === 1) {
      const w = tripletToWords(t, 'f');
      if (w) parts.push(`${w} ${pluralForm(t, THOUSAND_FORMS)}`);
    } else if (i === 2) {
      const w = tripletToWords(t, 'm');
      if (w) parts.push(`${w} ${pluralForm(t, MILLION_FORMS)}`);
    } else if (i === 3) {
      const w = tripletToWords(t, 'm');
      if (w) parts.push(`${w} ${pluralForm(t, BILLION_FORMS)}`);
    }
  }
  return sign + parts.join(' ').trim();
}

/**
 * numberToWordsRu — сумма прописью с валютой. Если currency UNKNOWN — выводит
 * только числовое представление прописью и копейки/«ед.» как fallback.
 *
 * Examples:
 *   numberToWordsRu(100, 'BYN')      → 'сто белорусских рублей 00 копеек'
 *   numberToWordsRu(1250.5, 'PLN')   → 'одна тысяча двести пятьдесят польских злотых 50 грошей'
 *   numberToWordsRu(99.99, 'EUR')    → 'девяносто девять евро 99 центов'
 *   numberToWordsRu(300, 'USD')      → 'триста долларов США 00 центов'
 */
export function numberToWordsRu(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = typeof amount === 'string' ? Number(amount.replace(/\s/g, '').replace(',', '.')) : amount;
  if (!Number.isFinite(n)) return '';

  // round to 2 decimal places
  const rounded = Math.round(n * 100) / 100;
  const intPart = Math.trunc(rounded);
  const fracPart = Math.round((Math.abs(rounded) - Math.abs(intPart)) * 100);

  const code = normalizeCurrency(currency);
  if (code === 'UNKNOWN') {
    // нет валюты — отдадим только число прописью + дробную часть цифрами
    const words = integerToWordsRu(intPart, 'm');
    const cap = words.charAt(0).toUpperCase() + words.slice(1);
    return `${cap} ${String(fracPart).padStart(2, '0')}/100`;
  }

  const forms = CURRENCY_FORMS[code];
  const majorWords = integerToWordsRu(intPart, forms.majorGender);
  const majorUnit = pluralForm(intPart, forms.major);
  const minorUnit = pluralForm(fracPart, forms.minor);
  const cap = majorWords.charAt(0).toUpperCase() + majorWords.slice(1);
  return `${cap} ${majorUnit} ${String(fracPart).padStart(2, '0')} ${minorUnit}`;
}

// ──────────────────────────── formatMoney ──────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  BYN: 'BYN', PLN: 'PLN', USD: 'USD', EUR: 'EUR', RUB: 'RUB',
};

export function formatMoney(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = typeof amount === 'string' ? Number(amount.replace(/\s/g, '').replace(',', '.')) : amount;
  if (!Number.isFinite(n)) return '';
  const fixed = n.toFixed(2);
  const [intPart, fracPart] = fixed.split('.');
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const code = normalizeCurrency(currency);
  const sym = code !== 'UNKNOWN' ? CURRENCY_SYMBOLS[code] : (currency || '');
  return sym ? `${withSpaces},${fracPart} ${sym}` : `${withSpaces},${fracPart}`;
}

// ──────────────────────────── DOCX token parser ────────────────────────────

export interface TokenLocation {
  part: string;
  count: number;
  raw_example?: string;
}

export interface TokenManifestEntry {
  token: string;
  locations: TokenLocation[];
  total_count: number;
}

const DOCX_TOKEN_RE = /\{\{\s*([^}{]+?)\s*\}\}/g;

/**
 * Какие части DOCX мы сканируем — все, где может быть user-visible текст.
 */
function listScannablePaths(zip: any): string[] {
  const all = Object.keys(zip.files || {});
  return all.filter((p) => {
    if (!p.startsWith('word/')) return false;
    if (!p.endsWith('.xml')) return false;
    // skip styles/settings/numbering/fontTable/theme/_rels/etc
    if (p.startsWith('word/_rels/')) return false;
    if (p.startsWith('word/theme/')) return false;
    if (/word\/(styles|settings|webSettings|fontTable|numbering|stylesWithEffects)\.xml$/.test(p)) return false;
    if (p.endsWith('.xml.rels')) return false;
    return (
      p === 'word/document.xml' ||
      /^word\/header\d*\.xml$/.test(p) ||
      /^word\/footer\d*\.xml$/.test(p) ||
      p === 'word/footnotes.xml' ||
      p === 'word/endnotes.xml' ||
      p === 'word/comments.xml' ||
      // text in floating shapes / drawings is usually inline in document.xml,
      // but glossary/document parts also may contain text
      /^word\/glossary\/document\.xml$/.test(p)
    );
  });
}

/**
 * extractDocxTokensWithLocations — расширенный парсер.
 * Сканирует все релевантные части DOCX, извлекает {{...}} токены, дедуплицирует
 * и возвращает manifest с локациями.
 */
export function extractDocxTokensWithLocations(buffer: Uint8Array | ArrayBuffer): {
  tokens: string[];
  manifest: TokenManifestEntry[];
  parts_scanned: string[];
} {
  const zip = new PizZip(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  const paths = listScannablePaths(zip);
  const byToken = new Map<string, TokenManifestEntry>();

  for (const path of paths) {
    const file = zip.file(path);
    if (!file) continue;
    let text: string;
    try { text = file.asText(); } catch { continue; }
    // strip XML tags so split tokens (Word splits runs) merge — best-effort
    const flat = text.replace(/<[^>]+>/g, '');
    const counts = new Map<string, { count: number; example: string }>();
    let m: RegExpExecArray | null;
    DOCX_TOKEN_RE.lastIndex = 0;
    while ((m = DOCX_TOKEN_RE.exec(flat)) !== null) {
      const token = m[1].trim();
      if (!token) continue;
      const cur = counts.get(token);
      if (cur) cur.count += 1;
      else counts.set(token, { count: 1, example: m[0] });
    }
    for (const [token, info] of counts) {
      let entry = byToken.get(token);
      if (!entry) {
        entry = { token, locations: [], total_count: 0 };
        byToken.set(token, entry);
      }
      entry.locations.push({ part: path, count: info.count, raw_example: info.example });
      entry.total_count += info.count;
    }
  }

  const manifest = Array.from(byToken.values()).sort((a, b) => a.token.localeCompare(b.token));
  const tokens = manifest.map((e) => e.token);
  return { tokens, manifest, parts_scanned: paths };
}
