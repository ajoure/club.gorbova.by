// ============================================================================
// amount-with-words.ts — «Сумма прописью» в формате:
//   100,56 BYN → "100 (сто) рублей, 56 копеек"
//   1,01 BYN  → "1 (один) рубль, 01 копейка"
//   2,04 BYN  → "2 (два) рубля, 04 копейки"
//
// Правила:
//   1) число рублей цифрами;
//   2) в скобках сумма прописью строчными буквами;
//   3) согласованное слово рубль/рубля/рублей;
//   4) копейки двумя цифрами;
//   5) согласованное слово копейка/копейки/копеек.
//
// Для не-BYN валют сохраняется тот же шаблон с правильными формами:
//   USD → "100 (сто) долларов США, 00 центов"
//   EUR → "100 (сто) евро, 00 центов"
//   RUB → "100 (сто) рублей, 00 копеек"  (без «российских»)
// ============================================================================

import { ruIntToWords, ruPlural } from './ru-numerals.ts';

interface MoneyForms {
  major: [string, string, string];  // 1, 2-4, 5+
  majorGender: 'm' | 'f';
  minor: [string, string, string];
  minorGender: 'm' | 'f';
}

const FORMS: Record<string, MoneyForms> = {
  BYN: {
    major: ['рубль', 'рубля', 'рублей'],
    majorGender: 'm',
    minor: ['копейка', 'копейки', 'копеек'],
    minorGender: 'f',
  },
  RUB: {
    major: ['рубль', 'рубля', 'рублей'],
    majorGender: 'm',
    minor: ['копейка', 'копейки', 'копеек'],
    minorGender: 'f',
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
  PLN: {
    major: ['злотый', 'злотых', 'злотых'],
    majorGender: 'm',
    minor: ['грош', 'гроша', 'грошей'],
    minorGender: 'm',
  },
};

function parseAmount(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string'
    ? Number(v.replace(/\s+/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''))
    : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * formatAmountWithWordsByRublesAndKopecks(100.56, 'BYN') → "100 (сто) рублей, 56 копеек"
 */
export function formatAmountWithWordsByRublesAndKopecks(
  amount: number | string | null | undefined,
  currency: string | null | undefined = 'BYN',
): string {
  const n = parseAmount(amount);
  if (n === null) return '';
  const code = (currency || 'BYN').toUpperCase();
  const f = FORMS[code] || FORMS.BYN;
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const rub = Math.trunc(abs);
  const cop = Math.round((abs - rub) * 100);
  const rubWords = ruIntToWords(rub, f.majorGender === 'f');
  const rubUnit = ruPlural(rub, f.major);
  const copUnit = ruPlural(cop, f.minor);
  const copStr = String(cop).padStart(2, '0');
  return `${sign}${rub} (${rubWords}) ${rubUnit}, ${copStr} ${copUnit}`;
}
