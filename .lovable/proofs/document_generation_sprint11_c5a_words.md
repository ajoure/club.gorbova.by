# Sprint 11 — C5-A: реальное «прописью» в strict generator

Дата: 2026-05-08
Файл: `supabase/functions/canonical-document-generate-strict/index.ts`
Версия резолвера: `strict-1.2.0-c5a`

## Что добавлено

Inline-модуль русских числительных и дат (без внешних зависимостей):
- `ruIntToWords(n, female)` — целые числа до 999 999 999 999 («двести пятьдесят»,
  «три тысячи», «один миллион сорок две»).
- `ruMoneyWords(amount, currency)` — суммы с копейками и согласованной валютой:
  - `BYN` → «… белорусских рублей XX копеек»
  - `RUB` → «… рублей XX копеек»
  - `USD` → «… долларов США XX копеек»
  - `EUR` → «… евро XX копеек»
- `ruDateWords(s)` — дата в «восьмое января две тысячи двадцать пятого года»
  (порядковый день + месяц в Р.п. + год в Р.п.). Принимает `YYYY-MM-DD`,
  `DD.MM.YYYY`, `DD/MM/YYYY` и ISO.
- `ruPlural(n, [1, 2-4, 5+])` — корректное согласование рубль/рубля/рублей и
  копейка/копейки/копеек.
- Boolean `format=text` → «да» / «нет».

## Применение в pipeline

Цикл резолва (строки 384–402) теперь вызывает `applyFormat(rawValue, dataType, currency, format)`:

| dataType            | format=words                    | format=text |
|---------------------|---------------------------------|-------------|
| `money`             | `ruMoneyWords(value, currency)` | —           |
| `number`            | `ruIntToWords(value)`           | —           |
| `date` / `datetime` | `ruDateWords(value)`            | —           |
| `boolean`           | —                               | да / нет    |
| остальные           | base value + warning            | base value  |

Валюта берётся из `orders_v2.currency`; по умолчанию BYN.

## Warnings

`source_trace[fid].variants[]`:
- `format_applied: true|false`
- `rendered_value: "<итоговая строка после применения>"`
- `format_words_not_applied` снимается, если applied=true.
- `format_text_not_applied` снимается, если applied=true.
- `case_modifier_not_applied` остаётся (склонение → C5-B).

## Что НЕ меняется (по плану)

- `case=…` пока не применяется (C5-B: ФИО / должности / организации).
- email/Telegram/auto-generation/batch — OFF.
- Контракт плейсхолдера strict ID-first без изменений.
- Структура `token_manifest` без изменений.

## DoD

- Number/money/date с `format=words` рендерятся словами.
- Boolean с `format=text` → «да/нет».
- Если значение нечисловое/неразбираемое — fallback на base value + warning.
- `source_trace` явно показывает `format_applied` и итоговое `rendered_value`.
- Готовы к C5-B (склонения).
