// ============================================================================
// ru-numerals.ts — Russian numeral helpers (integer → words; plural).
// Extracted from canonical-document-generate-strict (Sprint 11 C5).
// ============================================================================

const RU_UNITS_M = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const RU_UNITS_F = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
const RU_TEENS = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const RU_TENS = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const RU_HUNDREDS = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];

function ruTriad(n: number, female: boolean): string {
  const out: string[] = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) out.push(RU_HUNDREDS[h]);
  if (t === 1) out.push(RU_TEENS[u]);
  else {
    if (t) out.push(RU_TENS[t]);
    if (u) out.push((female ? RU_UNITS_F : RU_UNITS_M)[u]);
  }
  return out.join(' ');
}

export function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function ruIntToWords(num: number, female = false): string {
  if (!Number.isFinite(num)) return '';
  num = Math.trunc(num);
  if (num === 0) return 'ноль';
  const neg = num < 0; num = Math.abs(num);
  const parts: string[] = [];
  const billions = Math.floor(num / 1_000_000_000); num %= 1_000_000_000;
  const millions = Math.floor(num / 1_000_000); num %= 1_000_000;
  const thousands = Math.floor(num / 1000); num %= 1000;
  const rest = num;
  if (billions) parts.push(ruTriad(billions, false), ruPlural(billions, ['миллиард','миллиарда','миллиардов']));
  if (millions) parts.push(ruTriad(millions, false), ruPlural(millions, ['миллион','миллиона','миллионов']));
  if (thousands) parts.push(ruTriad(thousands, true), ruPlural(thousands, ['тысяча','тысячи','тысяч']));
  if (rest) parts.push(ruTriad(rest, female));
  return (neg ? 'минус ' : '') + parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
