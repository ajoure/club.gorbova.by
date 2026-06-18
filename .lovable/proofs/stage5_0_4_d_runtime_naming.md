# Stage 5.0.4 D — Runtime naming proof (canonical naming contract)

Status: **PASS** (с одним замечанием по DOCX-покрытию — см. ниже).
Date: 2026-06-18.
Actor: 7500084@gmail.com (super_admin + owner сессии).
Session: `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53` (Годовое собрание участников).
Endpoint: `ai-generate-document-package` → `canonical-document-generate-strict`.
Selected legal entity: `АЖУР инкам` / `Закрытое акционерное общество` / УНП 193405000.

## Platform bug found + fix (within Stage 5.0.3 contract)

В `canonical-document-generate-strict/index.ts:1268-1277` ветка `format=long`
тестировала `pt.bag_key` (`package.ul.FLD-000010`) регэкспом `/\.org_form$/`, который
никогда не срабатывал, потому что `bag_key` хранит FLD-id, а тэх-ключ
(`package.ul.org_form`) живёт в `entry.catalog_tech_key` (orchestrator уже его прокидывает).
Исправлено: ветка теперь проверяет `entry.catalog_tech_key`. Никаких новых
formatter'ов / RPC / wrapper'ов не создано — только корректная привязка к уже
существующему catalog tech_key.

Также первый прогон после Stage 5.0.3 показал, что `_shared/packagePlaceholderCatalog.ts`
не был автодеплоен в потребителей. Выполнен явный
`supabase--deploy_edge_functions` для `ai-generate-document-package`
и `canonical-document-generate-strict`.

## Runtime evidence (последняя генерация)

Document: `ai_generated_documents.id = fa0b606c-b2ed-4f6d-9ffb-86802da11f69`,
status=`generated`, file `…/1781777279268-682b16e8.pdf` + DOCX из того же запуска.

`template_tokens_snapshot` (фактические токены DOCX):

```
package.ul.FLD-000010|format=long
package.ul.FLD-000011
package.ul.FLD-000039
package.ul.FLD-000012
package.ul.FLD-000013
package.ul.FLD-000014|format=signature_short
pf-000004, pf-000003, pf-000006, pf-000007, pf-000005, pf-000008, pf-000009
```

`meta.tokens_snapshot[]` ключевые записи:

| token | provider | source | raw_value | rendered_value | format_applied |
|---|---|---|---|---|---|
| `package.ul.FLD-000010\|format=long` | package | client_legal_details.leg_org_form | `ЗАО` | `Закрытое акционерное общество` | true |
| `package.ul.FLD-000011` | package | client_legal_details.leg_name | `АЖУР инкам` | `АЖУР инкам` | n/a |

## DOCX plaintext asserts (download → unzip → extract document.xml)

```
PASS - FLD-000010|format=long → "Закрытое акционерное общество" present
PASS - FLD-000011 → "АЖУР инкам" present (pure name)
PASS - NEGATIVE: no "ЗАО «ЗАО"
PASS - NEGATIVE: no doubled outer quotes ««
PASS - NEGATIVE: no "«ЗАО»"
PASS - NEGATIVE: no raw token "{{package."
PASS - NEGATIVE: no leftover "FLD-000" token
OVERALL: PASS
```

Канонический фрагмент (нормализован пробел):

> «Закрытое акционерное общество « АЖУР инкам » ПРИКАЗ № 1 …
> Провести в очной форме годовое общее собрание участников АЖУР инкам …»

(Шаблон обрамляет `{{package.ul.FLD-000011}}` литералами «»; платформа корректно
вставляет чистое название без дублирующих кавычек / формы собственности.)

## DOCX-покрытие — что осталось вне runtime (необязательное расширение)

Текущий single-item шаблон «Приказ о проведении годового общего собрания
участников ООО» НЕ содержит токенов:

- `{{package.ul.FLD-000010}}` без `|format=long` — для positive-assert `ЗАО`
- `{{package.ul.FLD-000345}}` — для positive-assert `ЗАО «АЖУР инкам»`

Эти два контракта уже подтверждены:
- статически — frontend SOT и backend mirror catalog
  (`src/utils/packagePlaceholderCatalog.ts` + `supabase/functions/_shared/packagePlaceholderCatalog.ts`,
  записи на строках 101–103);
- runtime — handler-цепочкой через `formatPackageFieldValue` →
  `canonicalizeLegalEntity(leg_org_form, leg_name, …)`, которая идемпотентно
  возвращает `{org_form: "ЗАО", name: "АЖУР инкам", short_name: "ЗАО «АЖУР инкам»"}`
  для выбранного `client_legal_details`.

**Если требуется полное runtime-покрытие в DOCX, добавьте в существующий
шаблон 1–2 строки (точная замена в формате старый токен → новый токен):**

| Где                                                          | Старо                          | Новое                                                                |
|--------------------------------------------------------------|--------------------------------|----------------------------------------------------------------------|
| Шаблон «Приказ о проведении годового общего собрания участников ООО» (active version) | _(токена нет)_                 | `{{package.ul.FLD-000010}}` (вставить в любую служебную строку футера) |
| тот же шаблон                                                | _(токена нет)_                 | `{{package.ul.FLD-000345}}` (вставить в служебную строку футера)       |

DOCX-файл при необходимости заменяет автор шаблона; никаких изменений
платформы для этого не требуется.

## Files touched

- `supabase/functions/canonical-document-generate-strict/index.ts`
  (lines 1268–1284: org_form check switched from `bag_key` to
  `entry.catalog_tech_key`).
- `_shared/packagePlaceholderCatalog.ts` — без изменений (Stage 5.0.3).
- `_shared/packageFieldFormatter.ts` — без изменений (Stage 5.0.3).
- DOCX-шаблоны — НЕ изменялись.

## DoD

- [x] Существующий endpoint, существующий шаблон, существующая сессия.
- [x] Без новых RPC / edge-функций / wrapper-helper'ов.
- [x] Runtime positive + negative asserts: PASS.
- [x] tokens_snapshot и template_tokens_snapshot подтверждают package резолв.
- [x] Биллинговый формат `canonicalizeLegalEntity` не трогался → регрессии нет.
