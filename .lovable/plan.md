да, согласен, с учетом правок:

1. **Добавить в Discovery обязательную проверку фактического шаблона**, который ты сейчас использовал вручную:
  - какие именно `FLD-...` есть в DOCX;
  - какие из них относятся к B-97;
  - какие из них `postponed-51`;
  - какие вообще не существуют / не связаны с `document_token_registry`.
2. **Не ограничиваться только последним** `ai_generated_documents`, а найти именно документ, созданный из твоего тестового шаблона:
  - по `template_id`;
  - по `order_id`;
  - по `document_number`;
  - по времени генерации.
3. **Добавить отдельный proof по кнопке тарифа “Чат”**:
  - `tariff_offers.id`;
  - `tariff_offers.meta.document_scenarios`;
  - `template_id`;
  - `executor_id`;
  - `payer_type`;
  - payment channel;
  - итог: почему scenario должен был сматчиться.
4. **Обязательно проверить не только** `DealPayerDocumentsCard`**, но и путь создания order**:
  - `bepaid-create-token`;
  - `test-payment-complete`;
  - webhook / payment completion;
  - где именно должен записываться `offer_id`;
  - почему в новой сделке снова не сработал ранее заявленный fix.
5. **В Execute запретить ручное заполнение order/meta для proof**.  
Нельзя вручную проставлять `template_id`, `executor_id`, `offer_id`, `meta.documents`, чтобы “доказать” успех. Proof должен быть только через новую тестовую оплату.
6. **В Verify добавить сравнение UI vs backend**:
  - UI показывает resolved template/executor;
  - backend snapshot показывает те же `template_id/executor_id`;
  - `ai_generated_documents.source_trace` показывает тот же источник;
  - если UI и backend расходятся — задача не закрыта.
7. **По B-97 FLD добавить жёсткий fail-condition**:  
если хотя бы один FLD из реального шаблона есть в `fields_registry`, но в `token_manifest_snapshot` пустой без warning — это баг `silent empty`, задача не закрыта.
8. **Финальный DoD усилить**:  
задача закрыта только после новой тестовой оплаты, где:
  - сделка сама подтянула шаблон и исполнителя;
  - кнопка «Создать документ» активна без ручного выбора;
  - PDF создан;
  - реквизиты заполнены;
  - в PDF нет пустых конструкций;
  - `token_manifest_snapshot` содержит непустые значения по всем FLD из шаблона.

С этими правками план можно запускать.

&nbsp;

План:

# B-97 full-flow hotfix: документ из оплаты → сделка → PDF

## 1. Проблема

В одном пользовательском сценарии проявляются две связанные ошибки:

1. На новой сделке `#ORD-TEST-MPCP6D01` из тестовой оплаты тарифом «Чат» блок «Документы / плательщик» снова не подтягивает настройки кнопки:
  - `Шаблон документа: Автоматически (не задан в кнопке)`;
  - `Исполнитель: Автоматически (не задан в кнопке)`;
  - красные ошибки `не выбран шаблон` / `не выбран исполнитель`;
  - кнопка «Создать документ» disabled.
2. В уже сгенерированном счёт-акте FLD-first поля реквизитов B-97 валидируются, но в PDF приходят пустыми:
  - `в лице , действующего на основании`;
  - `физическое лицо ,`;
  - `ИСПОЛНИТЕЛЬ: , УНП . Адрес: .`;
  - `расчетный счет в , код .`.

Это нельзя считать двумя независимыми слоями без proof: для пользователя это один flow — создать оплату → открыть сделку → создать документ → получить заполненный PDF.

## 2. Диагностика

### 2.1. Discovery по автоподтягиванию настроек кнопки

Найти заказ со скрина:

```sql
SELECT id, order_number, status, offer_id, tariff_id, product_id,
       payer_type, profile_id, user_id, customer_email, meta, created_at
FROM orders_v2
WHERE order_number = 'ORD-TEST-MPCP6D01';
```

Если номер отличается — взять последние тестовые сделки:

```sql
SELECT id, order_number, status, offer_id, tariff_id, product_id,
       payer_type, profile_id, user_id, customer_email, meta, created_at
FROM orders_v2
ORDER BY created_at DESC
LIMIT 10;
```

Проверить, где реально лежит `offer_id`:

```sql
SELECT id,
       order_number,
       offer_id AS column_offer_id,
       meta->>'offer_id' AS meta_offer_id,
       meta->>'tariff_offer_id' AS meta_tariff_offer_id,
       meta->'checkout'->>'offer_id' AS checkout_offer_id,
       meta->'payment'->>'offer_id' AS payment_offer_id,
       meta
FROM orders_v2
WHERE order_number = 'ORD-TEST-MPCP6D01';
```

По найденному `offer_id` проверить кнопку/оффер:

```sql
SELECT id, tariff_id, product_id, title,
       meta->'document_defaults' AS document_defaults,
       meta->'document_scenarios' AS document_scenarios,
       meta
FROM tariff_offers
WHERE id = '<offer_id>';
```

Ответить proof-ом:

- есть ли `document_scenarios`;
- есть ли `template_id`;
- есть ли `executor_id`;
- включён ли сценарий;
- матчится ли он по `payer_type`;
- матчится ли он по payment channel;
- почему UI показывает «Источник не задан».

Проверить frontend resolver:

```bash
rg -n "offer_id|tariff_offer_id|document_scenarios|document_defaults|resolveDocumentScenario|Источник не задан|Автоматически" src/components/admin/DealPayerDocumentsCard.tsx src -S
```

Проверить backend/snapshot resolver:

```bash
rg -n "offer_id|tariff_offer_id|document_scenarios|document_defaults|resolveDocumentScenario" supabase/functions -S
```

Обязательный вывод: backend должен использовать тот же fallback `offer_id`, что и UI. Нельзя допустить состояние, где UI показывает шаблон/исполнителя, а генерация backend идёт без scenario/defaults.

### 2.2. Discovery по пустым B-97 FLD

Найти конкретный сгенерированный документ:

```sql
SELECT id, template_id, template_version_id, context_type, context_id,
       document_number, file_path,
       token_manifest_snapshot, missing_tokens, warnings_snapshot,
       source_trace, meta, created_at
FROM ai_generated_documents
ORDER BY created_at DESC
LIMIT 5;
```

Проверить проблемные FLD из реального шаблона:

- `FLD-000366`, `FLD-000363`, `FLD-000362`, `FLD-000347`, `FLD-000369`, `FLD-000354`, `FLD-000359`, `FLD-000361`, `FLD-000360`, `FLD-000367`, `FLD-000365`;
- `FLD-000313`, `FLD-000321`, `FLD-000322`, `FLD-000261`, `FLD-000262`.

Проверить snapshot keys:

```sql
SELECT jsonb_object_keys(token_manifest_snapshot)
FROM ai_generated_documents
WHERE id = '<document_id>'
ORDER BY 1;
```

Проверить `missing_tokens`, `warnings_snapshot`, `source_trace` и связку FLD → token_key:

```sql
SELECT fr.public_id, fr.key AS fields_registry_key, fr.label,
       fr.entity_type, fr.data_type, fr.options,
       dtr.token_key, dtr.field_id, dtr.resolver_key,
       dtr.source_type, dtr.ui_label, dtr.example_value, dtr.archived_at
FROM fields_registry fr
LEFT JOIN document_token_registry dtr ON dtr.field_id = fr.id
WHERE fr.public_id IN ('FLD-000366','FLD-000363','FLD-000362','FLD-000347',
                       'FLD-000313','FLD-000321','FLD-000322','FLD-000354',
                       'FLD-000369','FLD-000359','FLD-000361','FLD-000360',
                       'FLD-000367','FLD-000365')
ORDER BY fr.public_id;
```

Проверить pipeline генерации:

```bash
rg -n "FLD-000366|field:FLD|token_manifest_snapshot|buildTypedNamespaceValues|customer.ind|customer.leg|customer.ent|executor.leg" supabase/functions src -S
```

Проверить SOT-данные:

```sql
SELECT id, order_number, status, payer_type, profile_id, user_id,
       customer_email, customer_phone, meta
FROM orders_v2
WHERE id = '<order_id>';

SELECT *
FROM client_legal_details
WHERE profile_id = '<profile_id>'
ORDER BY client_type, is_default DESC, updated_at DESC;

SELECT meta->'document_data'->>'executor_id',
       meta->'document_data'->'_provenance'->'executor_resolution'
FROM orders_v2
WHERE id = '<order_id>';

SELECT *
FROM executors
WHERE id = '<executor_id>';
```

## 3. Возможные root causes

### 3.1. Автоподтягивание кнопки

Проверить и доказать фактическую причину:

- A. Новый test/admin payment пишет `offer_id` не в `order.offer_id` и не в `meta.offer_id`, а в `meta.tariff_offer_id`, `meta.checkout.offer_id`, `meta.payment.offer_id` или другое поле.
- B. `offer_id` есть, но `tariff_offers.meta.document_scenarios` / `document_defaults` пустые — проблема сохранения настроек кнопки.
- C. `document_scenarios` есть, но resolver не матчится по `payer_type`, payment channel, enabled/template/executor.
- D. UI читает scenario, backend snapshot/generation не читает.
- E. Старые override-поля с `null` перетирают auto scenario; null override не должен блокировать scenario.

### 3.2. Пустые B-97 FLD

Проверить и доказать фактическую причину:

- A. B-97 resolver patch не подключён к фактическому pipeline генерации.
- B. Typed values строятся как `resolverValues[token_key]`, но `{{field:FLD-...}}` не маппится через `field_id → token_key`.
- C. Фактические `token_key` в БД отличаются от ключей, которые пишет resolver.
- D. Нет `executor_id` в order/scenario/defaults/snapshot.
- E. `payer_type` не совпадает с `client_legal_details.client_type` или resolver смотрит не тот `profile_id`.
- F. Генератор берёт старый snapshot без live overlay для новых typed FLD.

## 4. Предлагаемое решение

### 4.1. Единый resolver offer_id для UI + backend

Ввести/использовать единое правило:

```ts
getOrderOfferId(order) =
  order.offer_id
  ?? order.meta?.offer_id
  ?? order.meta?.tariff_offer_id
  ?? order.meta?.checkout?.offer_id
  ?? order.meta?.payment?.offer_id
  ?? null
```

Применить его в:

- `DealPayerDocumentsCard`;
- backend snapshot/scenario resolver;
- generation pipeline, который реально создаёт `ai_generated_documents`.

Scenario resolution должен возвращать provenance:

- `template_resolution.source = override | scenario | defaults | missing`;
- `executor_resolution.source = override | scenario | defaults | missing`;
- `source_trace.offer_id`;
- `source_trace.scenario_id` или объяснение `scenario_not_matched:<reason>`.

Null override не блокирует auto scenario; override применяется только если явно задан admin override.

### 4.2. B-97 FLD resolver fix

Минимально исправить тот pipeline, который реально генерирует документ:

- обеспечить lookup `{{field:FLD-XXXXXX}} → fields_registry.public_id → document_token_registry.token_key → resolverValues[token_key]`;
- убедиться, что typed values попадают в `token_manifest_snapshot` под FLD-ключом и token_key;
- добавить warnings вместо silent empty:
  - `typed_token_source_missing:<token_key>`;
  - `typed_token_empty_value:<token_key>`;
  - `typed_token_resolver_missing:<token_key>`;
  - `executor_id_missing_for_typed_token`;
  - `customer_requisites_missing_for_payer_type:<payer_type>`;
- `source_trace` должен показывать реальные источники:
  - `client_legal_details.ind_*`;
  - `client_legal_details.leg_*`;
  - `client_legal_details.ent_*`;
  - `executors.*`.

## 5. Изменяемые компоненты

Потенциально, после discovery:

- `src/components/admin/DealPayerDocumentsCard.tsx` — UI scenario/defaults resolution и status text.
- `supabase/functions/_shared/document-data-snapshot.ts` — backend snapshot для template/executor/payer data.
- `supabase/functions/_shared/document-scenario-resolver.ts` — scenario/defaults matching.
- `supabase/functions/_shared/typed-tokens-resolver.ts` — typed B-97 values, warnings/source_trace.
- `supabase/functions/_shared/document-render.ts` или strict generator path — только если discovery докажет, что именно он используется.
- `supabase/functions/canonical-document-generate*/index.ts` — только фактический entrypoint генерации.
- Proof artifacts:
  - `.lovable/proofs/fl_typed_tokens_empty_in_generated_doc_discovery_2026_05_19.md`;
  - `.lovable/proofs/document_generation_full_flow_fix_2026_05_19.md`.

## 6. Что не будет изменено

- `payments_v2`.
- `orders_v2 schema`.
- `allocate_document_number`.
- Хранилище document scenarios как модель данных, если discovery не докажет баг сохранения.
- Contact Center.
- Production-шаблоны.
- Hard-delete токенов.
- Postponed 51: `executor.ind.*`, `executor.ent.*`, `executor.leg.org_form`.
- Создание новых FLD.
- Морфология, если root cause не в ней.

## 7. Dry-run

Перед fix выполнить read-only proof:

1. SQL proof по `ORD-TEST-MPCP6D01`: order, все возможные `offer_id` paths, `meta.documents`.
2. SQL proof по `tariff_offers`: document scenarios/defaults.
3. Code proof через `rg`: UI + backend paths для `offer_id`, scenario/defaults, B-97 typed tokens.
4. SQL proof по последнему `ai_generated_documents`: snapshot/missing/warnings/source_trace.
5. SQL proof по FLD → token_key для проблемных FLD.
6. SOT proof по `client_legal_details` и `executors`.

STOP после dry-run, если:

- order не найден;
- `offer_id` не найден ни в одном path;
- `tariff_offers` не содержит нужных settings;
- B-97 FLD не связаны с `document_token_registry`;
- SOT-данные реально отсутствуют и нечего резолвить;
- pipeline генерации не определён.

## 8. Execute

После доказанного root cause:

1. Исправить `offer_id` resolution в UI и backend единым helper/rule.
2. Исправить scenario/defaults matching, если причина в payer/payment channel/null override.
3. Исправить B-97 FLD mapping/resolver в фактическом pipeline генерации.
4. Добавить warnings/source_trace для typed FLD.
5. Не расширять scope за B-97.

## 9. Verify

### 9.1. До генерации на новой тестовой оплате

Создать новую тестовую оплату для `7500084@gmail.com`, тариф «Чат». В карточке сделки проверить:

- шаблон подтянулся автоматически из кнопки;
- исполнитель подтянулся автоматически из кнопки;
- тип плательщика определён;
- карточка реквизитов выбрана;
- нет красных ошибок `не выбран шаблон` / `не выбран исполнитель`;
- кнопка «Создать документ» активна.

### 9.2. После генерации

В PDF проверить:

- нет `{{...}}`;
- нет пустых реквизитов:
  - `в лице ,`;
  - `действующего на основании ,`;
  - `физическое лицо ,`;
  - `УНП .`;
  - `Адрес: .`;
  - `расчетный счет в , код .`;
  - `Телефон . Электронная почта: .`;
- заполнены executor/customer requisites, услуга/цена/сумма/валюта/сроки.

DB proof:

```sql
SELECT order_number, offer_id,
       meta->>'offer_id',
       meta->>'tariff_offer_id',
       meta->'checkout'->>'offer_id',
       meta->'payment'->>'offer_id',
       meta->'documents'
FROM orders_v2
WHERE order_number = '<new_test_order>';

SELECT token_manifest_snapshot, warnings_snapshot, source_trace
FROM ai_generated_documents
WHERE context_id = '<new_order_id>'
ORDER BY created_at DESC
LIMIT 1;
```

Также выполнить `tsc` и `deno check` через стандартный verify-процесс.

## 10. STOP-guards

- Не чинить blind fix без SQL/code proof.
- Не создавать новые FLD.
- Не менять schema `orders_v2`.
- Не писать manual DB updates в `orders_v2` для имитации успеха.
- Не считать UI proof достаточным без backend proof.
- Не считать backend proof достаточным без реального PDF proof.
- Не включать postponed 51.
- Не менять document numbering.
- Не менять payment fulfillment.

## 11. DoD

Задача закрыта только если на новой тестовой оплате `7500084@gmail.com` тариф «Чат»:

1. Сделка автоматически подтягивает шаблон и исполнителя из кнопки.
2. UI больше не показывает `Источник не задан` для реально настроенного scenario/defaults.
3. Backend generation использует тот же resolved scenario, что UI.
4. `token_manifest_snapshot` содержит непустые значения по проблемным B-97 FLD.
5. `source_trace` показывает реальные источники для FLD и scenario/defaults.
6. PDF не содержит `{{...}}` и пустых реквизитных конструкций.
7. В отчёте указано, почему прошлый fix по `offer_id` был неполным.
8. В отчёте указано, где именно лежал `offer_id` в новой сделке.
9. В отчёте указано, почему B-97 FLD были пустыми.
10. STOP-guards подтверждены.

## 12. Финальный отчёт

Создать:

`.lovable/proofs/document_generation_full_flow_fix_2026_05_19.md`

В отчёте обязательно:

1. Почему прошлый fix по `offer_id` оказался неполным.
2. Где именно лежал `offer_id` в новой сделке.
3. Почему UI снова показывал «Источник не задан».
4. Почему B-97 FLD были пустыми.
5. Какие файлы исправлены.
6. Proof новой сделки до генерации.
7. Proof PDF после генерации.
8. `token_manifest_snapshot` / `source_trace` по проблемным FLD.
9. Warnings proof.
10. Подтверждение STOP-guards.

Пока новая тестовая сделка не подтягивает шаблон/исполнителя автоматически и PDF не заполнен реквизитами — B-97 full-flow НЕ закрыт.