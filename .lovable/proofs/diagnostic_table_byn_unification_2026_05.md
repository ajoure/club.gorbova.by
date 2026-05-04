# Унификация валюты BYN в diagnostic_table блоках

Дата: 2026-05-04
Задача: «нужно исправить и сделать одну валюту везде - BYN»
Область: тренинг «Бухгалтерия как бизнес», урок-тест «В какой роли» (V1) и «Шаг 2: Анализ и формирование портфеля клиентов» (V2).

## Before-snapshot instruction (для отката)

### Block 16d68578-fe7b-44df-a646-0ebdace87a04 (V2, lesson 6fb911a0)

```html
<div style="text-align: left;"><span style="font-size: 0.875rem; color: rgb(15, 23, 41);">Дозаполните таблицу аналитическими данными по каждому клиенту</span></div>
```

### Block 81a10e8d-ec5a-40f6-9926-5bfb4953cd2a (V1, lesson 96c970e6)

```text
Заполните таблицу. Каждая строка — один источник дохода.
```

## Объём затронутых блоков

Read-only поиск по БД: всего 2 блока `block_type='diagnostic_table'`.
Других кандидатов с полями `income`/`monthly_income`/`hourly_rate`/`revenue` в коде или в `lesson_blocks` нет.

## Применённые UI-правки (Шаг 1)

Файл: `src/lib/diagnosticTableV1toV2.ts`
- `monthly_income`: `Доход в месяц` → `Доход в месяц, BYN`
- `hourly_income`: `Доход за час` → `Доход за час, BYN`

Файл: `src/components/admin/lesson-editor/blocks/DiagnosticTableBlock.tsx`
- V1 `DEFAULT_COLUMNS`: те же подписи `, BYN`.
- Шапки V2 desktop-таблиц (read-only summary + edit overview): `Доход` → `Доход, BYN`, `Доход/час` → `Доход/час, BYN`.
- Мобильная карточка summary: `Доход:` → `Доход, BYN:`.
- Строка итогов V1+V2: `BYN/мес` → `BYN / мес`, `Средний доход/час` → `Средний доход / час`.
- Плейсхолдер для number-инпута денежных колонок (`monthly_income`/`income`): `например, 1500`.
- Player-mode: добавлен `Alert` с подсказкой:
  > Все суммы указывайте в **BYN** (белорусских рублях).
  > Если сумма в USD — умножьте на **3** и внесите значение в BYN.
  > Если сумма в EUR — используйте курс, указанный в инструкции или администратором.

Computed-формулы НЕ менялись — `hourly_income = monthly_income / total_hours` корректен для любой согласованной валюты.

## Применённые контентные правки (Шаг 2)

Обновлён `content.instruction` обоих блоков: добавлен префикс с правилом конвертации USD×3 и пометкой EUR. Существующий текст инструкций сохранён.

## Что НЕ делалось

- Существующие 33+30 ответов в `lesson_progress_state` НЕ изменялись.
- `tariff_offers`, `orders_v2`, payment_links — вне области.
- Структура `state_json` не меняется.

## Следующий шаг (gated)

Шаг 3: dry-run отчёт для ретро-конвертации USD→BYN×3 с review-list (`user_id`, `client_name`, `old_value`, `suggested_value`, `confidence: high/medium/low`, `action`). UPDATE — только после ручного approve.
