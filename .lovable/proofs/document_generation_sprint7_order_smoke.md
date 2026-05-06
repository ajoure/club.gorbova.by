# Sprint 7 — Тестовая генерация DOCX по заказу + PATCH 1 (regen idempotency guard)

## PATCH 1 — Regeneration idempotency guard

Изменения:
- `_shared/document-render.ts` — `generateCanonicalDocument` принимает `bypassIdempotency` и `idempotencyKeyOverride`.
  При `bypassIdempotency:true` lookup по существующему idempotency_key не выполняется → reused невозможен.
- `canonical-document-regenerate` — execute использует `bypassIdempotency:true` + `idempotency_key=manual_regen:{src}:{ts}`,
  плюс жёсткие guard-проверки:
  - `result.reused === true` → audit `document.regenerate_blocked_reused_source` + 409.
  - `result.document_id === source_document_id` → тот же блок.
  - `!result.document_id` → тот же блок.
- Старая запись никогда не апдейтится (UPDATE идёт только по `result.document_id`, и только если он новый).

## Тестовый заказ

| Поле | Значение |
|---|---|
| order_id | `cdd70b23-c2a7-47bb-9156-147206947610` |
| order_number | `ORD-TEST-MOKH0RDW` |
| status | `paid` |
| product | `Gorbova Club` |
| amount / currency | 150 / BYN |
| profile_id | `a4b7c8c9-8210-499e-ae3f-2a5db2121577` (внутренний admin/owner) |
| email | 7500084@gmail.com |
| legal_details_id | `cca47181-eb25-4bf7-afbc-6037c52d21e9` |

Безопасен: внутренний тестовый профиль, не клиентский, ORD-TEST-* префикс.

## Флаги

```
до:    canonical=false, auto_generation=false
во время: canonical=true,  auto_generation=false
после:  canonical=false, auto_generation=false
```

## Preview (mode=preview)
- feature_enabled=true, missing_tokens=[], unmapped=0.
- `deal.amount_words = "Сто пятьдесят белорусских рублей 00 копеек"` ✅
- customer.* / executor.* / document.* заполнены.

## Generate #1
- document_id `62ad862d-d518-40dc-98af-af8e7ad56023`
- file: `canonical/a4b7c8c9.../AKT-260506-652.docx`
- idempotency_key: `service_act:cdd70b23-...:7ca3c870-...`
- snapshot/source_trace записаны.

## Generate #2 (idempotency)
- Возвращён тот же `document_id=62ad862d...`, та же ссылка.
- В БД по-прежнему 1 запись с этим context_id (до regenerate).

## Regenerate (mode=execute)
- diff: `document.date`, `document.number`.
- new document_id: `2cb311ea-480a-46ab-a0bd-49f9dc42f757`
- file: `AKT-260506-934.docx`
- `regenerated_from_document_id = 62ad862d...`
- `idempotency_key = manual_regen:62ad862d...:1778102483454`
- Старая запись `62ad862d...` не изменилась (created_at, file_path, idempotency_key прежние).

## Audit
```
document.regenerated  meta={ source=62ad862d, new=2cb311ea, diff_keys=[document.date, document.number],
                              idempotency_key=manual_regen:..., template_version_id=7ca3c870 }
```

## Legacy proof
- `generated_documents` count = 216 (не изменилось).
- Email/Telegram отправок нет — соответствующие функции не вызывались.
- `documents_service_act_auto_generation_enabled` остался `false` весь спринт.

## НЕ делалось
- Рассылка клиенту (email/Telegram).
- Авто-генерация по оплате.
- Массовая генерация.
- Production auto-generation.
- Изменение legacy таблиц/функций.

## Deferred → Sprint 8
- Массовая ручная генерация (batch).
- Контроль безопасной активации auto_generation за вторым флагом.
- Авто-доставка клиенту в кабинет (без email/Telegram пока).
