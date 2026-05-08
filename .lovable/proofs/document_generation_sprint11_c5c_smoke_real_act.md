# Sprint 11 · C5-C — Smoke-test (тех. часть, синтетический акт)

**Дата:** 2026-05-08
**Resolver version:** `strict-1.3.0-c5b` (с патчем парсера: `field:FLD-…|<bare>` → `unknown_modifier`)
**Сценарий:** end-to-end проверка strict ID-first сценария на синтетическом DOCX-акте (без UI).
**UI-часть (шаги 1–3 из плана C5-C):** не пройдена, остаётся за пользователем (загрузка реального .docx и разметка через picker в `/admin/ai → Документы`).

---

## 1. Шаблон и активная версия

| Поле | Значение |
|---|---|
| `template_id` | `51dd39fe-1491-48da-ad11-26ddf21678d5` |
| `template.name` | «Шаблон. Счёт-акт на услуги» |
| `current_version_id` | `f959059a-022d-4eb8-9c60-f30aa2dee907` |
| `version_number` | 2 |
| `is_current` | `true` (v1 переключена в `false`) |
| `validation_status` | `valid` |
| `markup_status` | `marked` |
| `storage_bucket` / `storage_path` | `documents` / `templates/c5c-smoke/v1.docx` |
| `editor_html` | заполнен |
| `editor_json` | заполнен (`{}`) |

### token_manifest (то, что лежит в версии)

| field_public_id | placeholder | format | case_modifier | label | data_type | required |
|---|---|---|---|---|---|---|
| FLD-000185 | `{{field:FLD-000185\|format=words}}` | words | — | Акт: дата | date | true |
| FLD-000152 | `{{field:FLD-000152\|case=genitive}}` | — | genitive | Исполнитель: ФИО руководителя | string | true |
| FLD-000152 | `{{field:FLD-000152}}` | — | — | Исполнитель: ФИО руководителя | string | true |
| FLD-000153 | `{{field:FLD-000153\|case=genitive}}` | — | genitive | Исполнитель: должность руководителя | string | true |
| FLD-000191 | `{{field:FLD-000191}}` | — | — | Услуга: сумма акта | number | true |
| FLD-000191 | `{{field:FLD-000191\|format=words}}` | words | — | Услуга: сумма акта | number | true |
| FLD-000003 | `{{field:FLD-000003\|format=text}}` | text | — | Активность тест | boolean | false |

Манифест содержит только канон-поля: `field_public_id`, `placeholder`, `format`, `case_modifier`, `label`, `data_type`, `required`. Никаких `token_key` нет.

---

## 2. Validation (strict)

Прогон `canonical-document-generate-strict mode=preview` с временной подменой `current_version_id`:

| Версия | Содержимое | Ответ | Код |
|---|---|---|---|
| v2 (FLD only) | `{{field:FLD-…}}`, `…|format=words`, `…|case=genitive`, `…|format=text` | `200` `success: true`, `can_generate: true` | — |
| v3 (legacy) | `{{document.amount}}` | `400` `error: legacy_placeholders_in_active_version` | `legacy_placeholder_format_detected` |
| v4 (unknown) | `{{field:FLD-000003\|upper}}` | `400` `error: unknown_modifier_in_active_version` | `unknown_modifier` |

> **Blocker найден и исправлен:** до патча `|upper` уходил в `legacy_placeholder_format_detected`. Добавлен `FIELD_PREFIX_RE`: если префикс `field:FLD-…` совпал, но строгий regex — нет, ошибка классифицируется как `unknown_modifier`. Эдж-функция передеплоена, повторный прогон → ожидаемый код.

После проверки активная версия возвращена на v2.

---

## 3. Тестовая сделка

| Поле | Значение |
|---|---|
| `order_id` | `27760d97-2e8c-49f1-af72-4fed0c5c9f4d` |
| `order_number` | `SUB-LINK-MOVS4YAF` |
| `currency` / `final_price` | `BYN` / `250.00` |
| Изменено | только `meta.document_data.fields` |
| product_id / tariff_id / offer | **не трогали** |

`orders_v2.meta.document_data.fields`:

```json
{
  "FLD-000185": { "value": "08.01.2025",                     "source": "manual_override", "manual_override": true },
  "FLD-000152": { "value": "Федорчук Сергей Владимирович",   "source": "manual_override", "manual_override": true },
  "FLD-000153": { "value": "генеральный директор",            "source": "manual_override", "manual_override": true },
  "FLD-000191": { "value": 250,                               "source": "manual_override", "manual_override": true },
  "FLD-000003": { "value": true,                              "source": "manual_override", "manual_override": true }
}
```

---

## 4. Preview

`POST /canonical-document-generate-strict` `mode=preview` → **200**.

```json
{
  "can_generate": true,
  "found_field_ids": ["FLD-000185","FLD-000152","FLD-000153","FLD-000191","FLD-000003"],
  "missing_field_ids": [],
  "required_empty_field_ids": [],
  "resolver_version": "strict-1.3.0-c5b",
  "resolved_tokens": {
    "field:FLD-000185|format=words":  "восьмое января две тысячи двадцать пятого года",
    "field:FLD-000152|case=genitive": "Федорчука Сергея Владимировича",
    "field:FLD-000152":               "Федорчук Сергей Владимирович",
    "field:FLD-000153|case=genitive": "генерального директора",
    "field:FLD-000191":               "250",
    "field:FLD-000191|format=words":  "двести пятьдесят",
    "field:FLD-000003|format=text":   "да"
  }
}
```

`source_trace` для каждого FLD содержит: `field_public_id`, `source`, `value`, `data_type`, `label`, `required`, `variants[]` с полями `placeholder / format / case / format_applied / case_applied / case_reason / rendered_value / warnings`. Для всех применённых модификаторов `warnings = []`.

---

## 5. Generate

`POST /canonical-document-generate-strict` `mode=generate` → **200**.

| Поле | Значение |
|---|---|
| `document_id` | `fea483aa-27c6-4c6a-b096-5a8a60a27b11` |
| `storage_bucket` / `storage_path` | `documents` / `generated/27760d97-2e8c-49f1-af72-4fed0c5c9f4d/1778270113642-51dd39fe.docx` |
| `download_url` | подписанная ссылка, действительна 1 ч |
| `resolver_version` | `strict-1.3.0-c5b` |

`ai_generated_documents.token_manifest_snapshot` совпадает с манифестом версии (7 записей, см. п. 1). `legacy generated_documents`: `0` вставок за последний час (untouched).

`audit_logs`:

```json
{
  "action": "document.generated",
  "actor_user_id": "05cd3754-d589-4d90-97d1-89ba2bee610b",
  "meta": {
    "document_id": "fea483aa-27c6-4c6a-b096-5a8a60a27b11",
    "order_id": "27760d97-2e8c-49f1-af72-4fed0c5c9f4d",
    "template_id": "51dd39fe-1491-48da-ad11-26ddf21678d5",
    "template_version_id": "f959059a-022d-4eb8-9c60-f30aa2dee907",
    "version_number": 2,
    "field_ids": ["FLD-000185","FLD-000152","FLD-000153","FLD-000191","FLD-000003"],
    "resolver_version": "strict-1.3.0-c5b"
  }
}
```

---

## 6. Проверка готового DOCX

`unzip -p word/document.xml | grep -oE '\{\{[^}]+\}\}'` → **пусто.**
`grep -oE '\{\{(document|executor|customer|deal|cf)\.[^}]+\}\}'` → **пусто.**

Видимый текст готового файла:

```
АКТ № 1
Дата: восьмое января две тысячи двадцать пятого года
Исполнитель в лице руководителя Федорчука Сергея Владимировича,
действующего по должности генерального директора.
Сумма акта: 250 BYN (двести пятьдесят).
Активность тест: да.
Подпись руководителя: Федорчук Сергей Владимирович.
```

Подтверждено:
- сумма прописью работает (`двести пятьдесят` для number; для `money` шёл бы вариант с «белорусскими рублями 00 копеек»);
- дата прописью работает (`восьмое января две тысячи двадцать пятого года`);
- boolean → «да» работает;
- ФИО склоняется в Р.п. уверенно (`Федорчука Сергея Владимировича`);
- должность склоняется уверенно (`генерального директора`);
- placeholder без модификатора рендерит исходное значение (`Федорчук Сергей Владимирович`);
- ни одного остаточного `{{…}}` в готовом DOCX.

---

## 7. Safety / flags

| Канал | Состояние |
|---|---|
| email-рассылка | не запускалась (smoke не вызывал email-функции) |
| Telegram | не запускался (не вызывался `telegram-grant-access` и пр.) |
| auto-generation | OFF (не вызывался `document-auto-generate`) |
| batch | OFF (не вызывался `ai-generate-document-package`) |
| доступы / entitlements / subscriptions | не тронуты (правки только в `orders_v2.meta.document_data` и `document_template_versions`) |
| legacy `generated_documents` | 0 вставок за последний час |
| `product_id` / `tariff_id` / offer выбранной сделки | не менялись |

---

## 8. Что не покрыто

Этот прогон — только тех. часть. Шаги UI плана C5-C остаются на ручную проверку:

- 1: загрузка реального DOCX акта в `/admin/ai → Документы → Шаблоны`;
- 2: визуальный редактор — chip с человеческим названием, видимый FLD-ID, отображение «прописью» / падежа в чипе;
- 3: сохранение через UI (кнопка «Сохранить разметку» → `canonical-template-apply-markup`) и проверка, что `editor_html`/`editor_json`/`token_manifest` записываются как ожидается;
- 5: активация через `canonical-template-activate-version` (в этом прогоне версия активирована напрямую в БД для тех. проверки);
- 6: вкладка «Документы» в сделке — UI заполнения и audit `document_data.field_updated`.

Эти проверки делает пользователь по чек-листу из плана C5-C (шаги 1–3, 5, 6). Когда они пройдены — smoke считается полностью green.

---

## Артефакты

- Версия v2 шаблона: `f959059a-022d-4eb8-9c60-f30aa2dee907`
- Сделка: `27760d97-2e8c-49f1-af72-4fed0c5c9f4d`
- Сгенерированный документ: `ai_generated_documents.id = fea483aa-27c6-4c6a-b096-5a8a60a27b11`
- Storage path: `documents/generated/27760d97-2e8c-49f1-af72-4fed0c5c9f4d/1778270113642-51dd39fe.docx`
- Negative-test версии (для повторных прогонов): v3 `cf7a045b-da84-4b2f-83d9-a7b974649383` (legacy), v4 `05dbf776-c637-43b6-8a83-f5e92d6e3688` (unknown).
- Patch: `STRICT_FIELD_RE` оставлен без изменений; добавлен `FIELD_PREFIX_RE`, чтобы корректно различать legacy и unknown_modifier.
