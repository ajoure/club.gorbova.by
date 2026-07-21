# Companies UI Benchmark — Preview /admin/companies

Дата: 2026-07-21
Область: только CRM Companies (read-only, без write/DDL/publish)
Оператор: Lovable agent (Playwright + Chromium headless)

## Окружение

| Параметр | Значение |
| --- | --- |
| Target URL | `http://localhost:8080/admin/companies` (Preview build served by sandbox; managed Supabase backend) |
| Preview HEAD SHA | `b26b4c1064bdbf92c2d8d3a6286a08b9c65edab6` |
| Preview branch | `edit/edt-79fe6b56-6f7d-4619-8163-dfea71e03c58` |
| Viewport | 1280 × 1800 CSS px, dpr=1 (headless Chromium) |
| Auth | `authenticated` (Lovable-managed Supabase session, cookies + localStorage) |
| Search term | `Фармакон` (существующая компания) |
| Company card ID | `d9ad08a3-bc36-4a37-be16-7f8a5d2f5bc0` (full_name = «ВИП Бел Логистик») |

Измерение — `performance.perf_counter()` от отправки действия
до полной стабилизации DOM (появление ожидаемого узла) + `networkidle`
(отсутствие сетевой активности ≥500 мс). Данные не мутировались.

## Search — 10 samples

Действие: очистить input, подождать 500 мс, ввести `Фармакон`, ждать
появления строки таблицы с этим текстом и `networkidle`.

| # | Тип | ms |
| --- | --- | --- |
| 0 | cold (свежая вкладка, пустой React Query cache) | **71.8** |
| 1 | warm | 51.8 |
| 2 | warm | 54.1 |
| 3 | warm | 49.8 |
| 4 | warm | 61.4 |
| 5 | warm | 52.9 |
| 6 | warm | 62.8 |
| 7 | warm | 51.2 |
| 8 | warm | 47.7 |
| 9 | warm | 56.9 |

Агрегаты:

- warm (n=9): p50 **52.9 ms**, p95 **62.8 ms**, min 47.7, max 62.8
- all (n=10): p50 **53.5 ms**, p95 **71.8 ms**, min 47.7, max 71.8

Целевой SLO: p95 ≤ 500 ms — **выполнено с запасом**.

Оговорка (важно): warm-сэмплы одного и того же терма попадают
в React Query cache (`["admin-companies", filters]`) и в основном
измеряют время рендера + `networkidle`, а не время RPC
`search_companies`. Cold-сэмпл (71.8 ms) — единственный,
включающий фактический сетевой вызов на managed Supabase; для
последовательности p95 по разным термам нужно отдельное измерение
с ротацией query, что выходит за рамки этой read-only проверки.

## Company card — 10 samples

Действие:

- cold: свежая вкладка → LS session → `GET /admin/companies?company=<id>`,
  ждать `[role="dialog"]` без спиннера и с `[role="tablist"]` + `networkidle`.
- warm: та же вкладка, `pushState` на `?company=<id>` → те же условия ожидания.

| # | Тип | ms |
| --- | --- | --- |
| 0 | cold (полный SPA-load + auth + list + карточка) | **2770.8** |
| 1 | warm | 181.4 |
| 2 | warm | 60.8 |
| 3 | warm | 96.2 |
| 4 | warm | 65.6 |
| 5 | warm | 70.3 |
| 6 | warm | 77.4 |
| 7 | warm | 98.9 |
| 8 | warm | 61.3 |
| 9 | warm | 78.8 |

Агрегаты:

- warm (n=9): p50 **77.4 ms**, p95 **181.4 ms**, min 60.8, max 181.4
- all (n=10): p50 **78.1 ms**, p95 **2770.8 ms**, min 60.8, max 2770.8

Целевой SLO: p95 ≤ 1500 ms.

- Warm p95 = 181.4 ms — **PASS**.
- Cold sample 2770.8 ms — **FAIL по SLO для одиночного холодного захода**.
  Это full SPA cold start (bundle + auth handshake + первый список
  компаний перед открытием листа), а не latency карточки как таковой.
  Компонент `CompanyDetailsSheet` идёт открытием того же URL без разогретого
  React Query cache и лишь одна карточка — того же ID, поэтому один и
  тот же ID кэшируется и повторные заходы моментальны. Для чистой
  cold-выборки карточки без cold-SPA нужен инструмент, отделяющий
  bundle/auth от `companies.select(...).eq(id)` — за рамками текущего
  read-only benchmark.

## Прочее (незамеренное)

- p95 разных карточек, ротация ID — не измерено (потребовалась бы
  подборка живых `company_id`; выходит за scope).
- RUM/analytics p95 — недоступно в Preview.
- Сетевые RPC-хронометры (`pg_stat_statements`) недоступны через
  анонимный/authenticated путь; требуют admin gate.

## Верификация read-only

- Не выполнено ни одного INSERT/UPDATE/DELETE.
- Не запускались миграции, edge-функции, RPC-writer'ы, публикации.
- Использовались только UI-навигация и уже существующий RPC
  `search_companies` (SELECT) через клиент.
