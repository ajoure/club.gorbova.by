# План: PR #524 «Сверка актов», exact SHA 4bdd224c6cd2c1ff96bcef7d64b3e6aaa5174682

Режим подготовки плана: READ-ONLY. Ничего не изменено, не применено, не задеплоено, Publish не нажимался. Предыдущий план по PR #514 не исполнялся.

## 1. Подтверждённые факты (read-only)

**SHA.** Рабочее дерево Lovable уже находится ровно на `4bdd224c6cd2c1ff96bcef7d64b3e6aaa5174682`, дерево чистое. Синхронизация exact SHA возможна и фактически не требует переключения.

**Состав коммита (16 файлов).** UI: `AiPageContent.tsx`, `PromptRunFlow.tsx`, `useAiChat.ts` + 6 тестов. Backend: новая `act-reconciliation-analyzer/index.ts`, три новых shared-модуля (`act-reconciliation-input/-extraction/-report.ts`), изменённый `_shared/ai-access.ts`, `supabase/config.toml` (`[functions.act-reconciliation-analyzer] verify_jwt = true`), миграция `20260923112039_cb_act_reconciliation_scenario.sql`.

**Миграция ещё НЕ применена.** В production:
- `app_sections` с `code='ai_act_reconciliation'` — 0 строк;
- `ai_user_prompts` с `code='act_reconciliation'` — 0 строк;
- конфликтов по code/section/prompt нет, миграция идемпотентна (`ON CONFLICT (code) DO UPDATE`, `WHERE NOT EXISTS` для rules).

**Продукты и тарифы.**
| Продукт | ID | Тарифов |
|---|---|---|
| Ценный бухгалтер \| 1 ступень 2.0 \| 20 поток | `3e43fb28-8322-41bc-bfee-714731bdc630` | 5 |
| Ценный бухгалтер \| 1 ступень 2.0 \| 21 поток | `2b7bf6d4-ad8d-46ad-9399-7f96c307c596` | 8 |

Ожидаемый rowcount новых `section_access` rules: **ровно 13** (5 + 8, все тарифы активны).
Baseline: `access_rules` всего **151**, из них `section_access` **62**. Ожидаемый post: **164** и **75**.

**Preflight внутри миграции.** `DO $$`-блок падает, если активная секция ≠ 1 или любой из счётчиков тарифов = 0. Текущие значения (5 и 8) проходят.

**Функции к deploy.** Ровно две:
- `act-reconciliation-analyzer` — новая; импортирует `_shared/ai-access.ts` и три новых shared-модуля, читает `LOVABLE_API_KEY`;
- `ai-access-status` — импортирует изменённый `_shared/ai-access.ts`.

Тот же shared-модуль импортируют также `asset-classifier`, `bank-statement-analyzer`, `gorbova-ai-chat`. Изменение в `ai-access.ts` — **аддитивное** (новые константы, третья ветка в `Promise.all`, новый denial-текст), поведение существующих сценариев не меняется, поэтому их redeploy в scope не входит. Если требуется полное единообразие bundle — это отдельный follow-up, не блокер.

**Секрет.** `LOVABLE_API_KEY` присутствует в production (managed). Значение не выводилось и не требуется.

## 2. Порядок исполнения

1. Sync exact SHA `4bdd224c…`; подтвердить чистое дерево и дельту ровно в 16 файлах.
2. Прогнать фронтовые тесты (`PromptRunFlow.test.tsx`, `useAiChat.reliability.test.ts`, 4 теста `actReconciliation*`). Красный тест — стоп.
3. Снять pre-read-back (запросы ниже).
4. Применить **только** миграцию `20260923112039_cb_act_reconciliation_scenario.sql`.
5. Снять post-read-back; сверить ожидаемые дельты.
6. Deploy ровно `act-reconciliation-analyzer` и `ai-access-status`.
7. Runtime smoke (п. 4).
8. Publish и визуальная проверка (п. 5).

## 3. Pre/post read-back запросы

```sql
-- 1) секция
select count(*) from app_sections where code='ai_act_reconciliation' and is_active=true;  -- pre 0, post 1
-- 2) промпт
select count(*) from ai_user_prompts where code='act_reconciliation' and is_active=true and is_archived=false; -- pre 0, post 1
-- 3) новые правила: только тарифы ЦБ20/21
select product_id, count(*) from access_rules
where grant_target_type='section_access'
  and target_ref=(select id::text from app_sections where code='ai_act_reconciliation')
group by product_id;  -- post: 5 и 8, других product_id быть не должно
-- 4) отсутствие изменений прочих правил
select count(*) from access_rules;                                    -- 151 -> 164
select count(*) from access_rules where grant_target_type='section_access'; -- 62 -> 75
-- 5) контроль: ни одно существующее правило не изменено
select count(*) from access_rules where updated_at > <момент_перед_миграцией>
  and target_ref <> (select id::text from app_sections where code='ai_act_reconciliation'); -- ожидается 0
```

Любое расхождение (rowcount ≠ 13, чужой product_id, изменение прочих правил) — **стоп** и откат не производится вручную: докладывается факт.

## 4. Безопасный runtime smoke (без реальных клиентских данных)

- Никаких тестовых пользователей не создаётся.
- Проверка «есть доступ»: под админом/владельцем открыть «Нейросеть» → режим «Сверка актов» виден и запускается.
- Два синтетических CSV (выдуманные контрагент, номера и суммы, без PII): загрузка ровно двух файлов → отчёт о расхождениях + проект письма.
- Проверка «нет доступа»: side-effect-free вызов `ai-access-status` от существующей учётной записи без тарифов ЦБ → сценарий `act_reconciliation` возвращает `allowed=false`, `denial_reason='act_reconciliation_not_in_products'`; либо, если такой учётки без риска нет, ограничиться контрактным тестом shared-модуля.
- Проверить, что доступы других ИИ-инструментов (`ai_asset_classifier`, `ai_bank_statement_analysis`) в том же ответе не изменились.
- Никаких писем контрагентам не отправляется — только генерация текста в интерфейсе.

## 5. Publish и визуальная проверка

Publish фронтенда после всех PASS. Затем на опубликованном URL — desktop и mobile: режим «Сверка актов» присутствует в списке, подсказка про загрузку двух файлов читаема, отчёт и письмо не обрезаны и не перекрываются. Скриншоты без PII и без подписанных URL.

## 6. Стоп-условия

SHA mismatch; красный тест; ошибка preflight-блока миграции; rowcount ≠ 13 или затронуты другие `access_rules`; отсутствие/недоступность `LOVABLE_API_KEY` в рантайме функции; любой critical finding security scan в scope. Известный фон: 13 pre-existing RLS findings, к этому scope не относятся и его не блокируют.
