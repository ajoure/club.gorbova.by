да, согласен, с учетом правок:

## **1. Уточнить PDF**

Не утверждать заранее, что `canonical-document-generate` сам создаёт PDF. По прошлым smoke он создавал DOCX, а PDF делался через LibreOffice.

Заменить:

```text
PDF создан (`file_path` указывает на `.pdf`, `file_mime='application/pdf'`)
```

на:

```text
DOCX создан через canonical-document-generate.
PDF создаётся из DOCX отдельной конвертацией LibreOffice для smoke-proof.
В ai_generated_documents может остаться DOCX file_path — это не ошибка.
```

## **2. Уточнить feature flag**

Если `canonical-document-generate` не запускается при `documents_canonical_generation_enabled=false`, тогда допустимо временно включить flag, как в предыдущем E2E.

Добавить:

```text
Если endpoint возвращает feature_disabled, временно включить documents_canonical_generation_enabled=true только на время smoke и обязательно вернуть прежнее значение в cleanup.
```





## **3.**

`warnings_snapshot` **— “ровно эти” заменить на “минимум эти”**

Могут быть системные warnings типа `document_data_live_fallback_used`, `payment_snapshot_missing_live_fallback_used`.

Заменить:

```text
должны присутствовать ровно эти
```

на:

```text
должны присутствовать expected case-warnings; дополнительные системные non-blocking warnings допустимы, если они не относятся к неудачному склонению customer.name / payer.name / executor.name / executor.director и не являются docx_check:*.
```





## **4.**

`executor.short_name` **warning зависит от значения**

Если `executor.short_name = ЗАО "АЖУР инкам"`, warning ожидаем. Если short_name вдруг другое — не фиксировать жёстко.

Уточнить:

```text
Если executor.short_name начинается с аббревиатуры ЗАО/ООО/ОАО/..., ожидается warning abbreviation_not_inflected и значение без изменения.
```

## **5. Итог**

После этих правок план можно выполнять.

Короткая команда для Lovable:

```text
План согласован с правками:

1. Smoke запускать только через non-strict canonical-document-generate, не strict.
2. PDF для proof можно создавать отдельной LibreOffice-конвертацией из DOCX; ai_generated_documents может хранить DOCX.
3. Если endpoint блокируется feature flag — временно включить flag и вернуть исходное значение после smoke.
4. Warnings проверять как expected case-warnings + отсутствие forbidden case-warnings; не требовать “ровно эти”, потому что могут быть системные non-blocking warnings.
5. executor.short_name warning ожидать только если short_name является аббревиатурой.
6. После smoke приложить DOCX, PDF, pdf-text, preview.json/report.md и отключить smoke-template.
```

После выполнения этого smoke морфологию можно закрывать полностью.

&nbsp;

План v2: финальный E2E smoke по морфологии падежей (legacy renderer)

## Цель

Закрыть DoD по морфологии (C5-B): доказать, что `_shared/document-render.ts` (через **non-strict** legacy `canonical-document-generate`) реально подставляет склонённые значения в DOCX и в финальный PDF на боевом order'е, без `{{...}}` в выходе и с ожидаемым составом warnings.

Strict pipeline (`canonical-document-generate-strict`, FLD-токены) — НЕ цель этого smoke и не используется.

## Ключевые правки относительно v1

1. Smoke идёт через `**canonical-document-generate**` (или фактический endpoint, который вызывает `_shared/document-render.ts`). Strict исключён, т.к. customer.*, payer.*, executor.* — это legacy token-key плейсхолдеры, не FLD.
2. Smoke-шаблон создаётся `is_active=false`, `template_status='in_development'`. Если non-strict endpoint умеет принимать `template_id`/`template_version_id` напрямую — активация не нужна. Если требует `is_active=true` — включаем только на время прогона и в cleanup гарантированно выключаем.
3. Feature flag `documents_canonical_generation_enabled` фиксируется до и после (proof-запросы), не меняем.
4. `executor.short_name|case=...` и `executor.director_short|case=...` — ожидаемые warnings, не баг.

## Шаги

### 0. Pre-flight proof (read-only)

```sql
-- Feature flag (до)
SELECT key, value FROM app_settings
WHERE key='documents_canonical_generation_enabled';

-- Order и snapshot customer.name
SELECT id, payer_type, profile_id,
       meta->'document_data'->'customer' AS snapshot_customer
FROM orders_v2
WHERE id='15927402-5566-4810-97cf-f1d5997e80ed';

-- Executor: ФИО директора и адрес с индексом
SELECT id, name, short_name, director_full_name, director_short_name,
       legal_address_structured->>'postal_code' AS postal
FROM executors
WHERE id='d0c7fe75-1192-40a9-bbae-b652b69e6882';
```

Acceptance pre-flight:

- `snapshot_customer.name` = `Федорчук Сергей Валерьевич` (или эквивалент с тремя кириллическими словами, поддающимися склонению). Если нет — берём другой order физлица с полным ФИО, иначе тест морфологии ФИО не валиден.
- `executors.postal_code` = `220035`.
- `director_full_name` непустой, кириллица.

### 1. Smoke-шаблон (DOCX)

- Сгенерировать `inflection_smoke_v1.docx` (docx-js) с блоком плейсхолдеров (см. §Состав ниже).
- Загрузить в bucket `documents-templates` под `smoke/inflection_smoke_v1.docx` (service_role INSERT).
- Вставить `document_templates`:
  - `code='smoke_inflection_v1'`, `name='Smoke: морфология падежей'`,
  - `document_type='service_act'`, `template_scope='billing'`,
  - `template_status='in_development'`, `**is_active=false**`,
  - `template_path='smoke/inflection_smoke_v1.docx'`.
- Зарегистрировать `document_template_versions` через тот же путь, что использует админка при upload.
- Если non-strict endpoint требует `is_active=true` — включить только на время прогона; в cleanup обязательно вернуть `false`.

Состав плейсхолдеров шаблона:

```
ФИО заказчика:
{{customer.name}}
{{customer.name|case=genitive}}
{{payer.name|case=genitive}}

Исполнитель:
{{executor.name}}
{{executor.name|case=genitive}}
{{executor.short_name|case=genitive}}      ← ожидается warning abbreviation_not_inflected

Директор:
{{executor.director}}
{{executor.director|case=genitive}}
{{executor.director_short|case=genitive}}  ← ожидается warning unsupported_field

Unsupported:
{{payment.amount|case=genitive}}           ← ожидается warning unsupported_field

Адрес исполнителя:
{{executor.address}}                        ← должен содержать 220035
```

### 2. Прогон non-strict canonical generator

Endpoint: `POST /functions/v1/canonical-document-generate` (legacy non-strict; именно он использует `_shared/document-render.ts`).

- `mode='preview'` → анализ `variants[]`, `unresolved_count`, `warnings`.
- `mode='generate'` с `idempotency_key='smoke_inflection_v1:{order_id}:{template_version_id}'` → сохраняем DOCX + PDF из `ai_generated_documents`.

Если фактическое имя функции отличается (грепом по `_shared/document-render.ts` импортёрам) — использовать его, но запрет на strict сохраняется.

### 3. Верификация (DoD-чеклист)

1. DOCX создан (`meta.docx_storage_path` присутствует).
2. PDF создан (`file_path` указывает на `.pdf`, `file_mime='application/pdf'`).
3. `unresolved_count = 0`.
4. В тексте PDF нет подстрок `{{` или `}}` (через `pdftotext - | grep`).
5. В PDF присутствуют:
  - `Федорчука Сергея Валерьевича` для `customer.name|case=genitive` (и для `payer.name|case=genitive` через alias).
  - `Закрытого акционерного общества "АЖУР инкам"` для `executor.name|case=genitive` (основной proof юрформы).
  - Корректный genitive для `executor.director|case=genitive` (склонение ФИО директора).
  - `220035` в `executor.address`.
  - `ЗАО "АЖУР инкам"` (без изменения) для `executor.short_name|case=genitive` — это ожидаемое поведение, аббревиатура.
  - Инициалы (без изменения) для `executor.director_short|case=genitive` — ожидаемое поведение.
6. `warnings_snapshot` ОЖИДАЕМЫЕ (должны присутствовать ровно эти):
  - `case_modifier_not_applied:payment.amount:unsupported_field`
  - `case_modifier_not_applied:executor.director_short:unsupported_field`
  - `case_modifier_not_applied:executor.short_name:abbreviation_not_inflected`
   Допустимо (не fail): `format_modifier_ignored_for_text:<token>`.
   ЗАПРЕЩЕНО (fail при наличии): любой warning для
  - `customer.name|case=genitive`
  - `payer.name|case=genitive`
  - `executor.name|case=genitive`
  - `executor.director|case=genitive`
7. `deno check supabase/functions/_shared/{document-render,case-format,ru-inflection}.ts` — clean.
8. Автохарнес `tsc --noEmit` — clean (запускается автоматически).
9. **Feature flag (после)** — повторный SELECT идентичен SELECT'у из §0. Никаких записей в `app_settings`.

Артефакты в `/mnt/documents/smoke/inflection/`:

- `preflight.json` (snapshot pre-flight SELECT'ов),
- `preview.json` (variants + warnings),
- `generated.docx`, `generated.pdf`,
- `pdf-text.txt`,
- `report.md` с DoD-чеклистом.

### 4. Cleanup

- `document_templates.is_active=false` (если включали в §1) — обязательно.
- Запись и `document_template_versions` оставляем (idempotency reuse, аудит).
- Email/Telegram/Contact Center/auto-generation — не задействованы по построению (ручной POST, без триггеров).
- Если `documents_canonical_generation_enabled` менялся — вернуть в исходное (по плану — не меняем).

## Что НЕ делаем

- Не используем `canonical-document-generate-strict`.
- Не модифицируем `_shared/document-render.ts`, `case-format.ts`, `ru-inflection.ts` (если smoke выявит баг — отдельный план).
- Не трогаем `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios storage.
- Не включаем production auto-generation.
- Не отправляем документ клиенту.
- Не меняем production-шаблоны.

## DoD

Все 9 пунктов §3 — зелёные, отчёт `report.md` приложен, smoke-шаблон inactive, feature flag без изменений. После этого C5-B (морфология) закрывается полностью.