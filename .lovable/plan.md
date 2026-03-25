# да, согласен, с учетом правок:

&nbsp;

1. В PATCH явно добавь, что сначала нужен **raw proof upload error** из edge function: точный текст ошибки storage upload / signed URL / insert, а не предположение. Пока нет raw error, нельзя утверждать, что проблема была «транзиентной».
2. В подпункте про error-doc insert расширь объем:
  &nbsp;
  - запись в ai_generated_documents нужна не только при download/render error,
  - но и при **upload failure**,
  - и при **signed URL failure** тоже, если файл загружен, но ссылка не выдана.
    Иначе batch снова теряет трассировку.
  &nbsp;
3. В manifest parity proof добавь обязательный **machine-readable proof**:
  &nbsp;
  - для 6 кейсов сохранить server manifest и frontend manifest в JSON,
  - сравнить 1:1 по template_code, included, reason, legal_basis, category, required_data, runtime_status, порядку.
    Не только текстовое описание в docs.
  &nbsp;
4. Временное правило SoT по runtime_status сформулируй жестче:
  &nbsp;
  - **до появления DB-колонки** frontend corporateTemplateSpec.ts = primary SoT,
  - server DEFAULT_RUNTIME_STATUS = synchronized fallback,
  - любое изменение статуса шаблона допустимо **только одной задачей в двух файлах одновременно**,
  - в финальном отчёте обязателен proof sync без расхождений.
  &nbsp;
5. В runtime activation matrix добавь запрет на массовый перевод статусов:
  &nbsp;
  - pending_sprint3 → active только **по каждому шаблону отдельно**,
  - proof для каждого: render ok → upload ok → record in DB → download ok → UI/history ok.
    Без полного цикла статус не менять.
  &nbsp;
6. В DoD добавь отдельный UI-proof с основной админ-учётки Сергея:
  &nbsp;
  - corporate batch виден в «Истории»,
  - grouping не сломан,
  - минимум один документ скачивается из UI,
  - proof делать из основной учётки [7500084@gmail.com](mailto:7500084@gmail.com).
  &nbsp;
7. В docs добавь отдельный раздел:
  **“Почему Sprint 3 ещё не закрыт без successful end-to-end generation”**
  с фиксацией, что наличие template records + storage files + pre-flight pass **не равно** закрытию спринта.
8. Не переводить в этом патче pending_sprint3 → active заранее по логике «DB active + file exists».
  Это только availability, а не runtime proof.
9. Добавь в план явную проверку, что после успешной генерации в batch.meta и/или document.meta реально есть:
  &nbsp;
  - source='corporate_wizard'
  - corporate_draft_session_id
  - procedure_mode
  - report_year
  - snapshot / resolver markers
    Это часть обязательного proof history integration.
  &nbsp;
10. В финальном отчёте по PATCH требуй отдельный блок:
  **“Остаточные GAP после S3-CLOSE-3”**, если хотя бы один шаблон останется pending_sprint3 или upload/download proof не будет закрыт.

&nbsp;

&nbsp;

PATCH S3-CLOSE-3 — Финальное закрытие Sprint 3

## Текущее состояние (по результатам инспекции)

**Что работает:**

- Все 18 corporate templates: DB records (`is_active=true`, `template_path` set) + storage files exist
- Edge function architecture: status flow, server manifest, person lookup, pre-flight — всё на месте
- `ai_generated_documents` и `ai_document_generation_batches` имеют все нужные колонки
- Service role key bypasses RLS → upload не должен блокироваться политиками

**Найденная проблема — upload blocker:**
Строка 600: upload path = `ai-generated/${profileId}/${fileName}`. Bucket `documents` is private. Service role key bypasses RLS, поэтому upload должен работать. Нужно протестировать edge function end-to-end, чтобы подтвердить или найти реальный blocker.

**Вторая проблема — runtime_status drift:**
`corporateTemplateSpec.ts` содержит 10 шаблонов с `pending_sprint3`, но `DEFAULT_RUNTIME_STATUS` в `corporate-manifest.ts` — та же самая карта. При этом ВСЕ templates в DB active + storage present. Значит pre-flight пропускает только `active` шаблоны (строка 332: `m.runtime_status === 'active'`), а из 8 annual meeting templates только 2 (`corp_order_meeting`, `corp_review_list`) имеют `active` status. Это означает генерация максимум 2 документов, не 8.

---

## Этапы

### Этап 1. Deploy и тестирование edge function end-to-end

Deploy `ai-generate-corporate-package` и вызвать через `curl_edge_functions` с реальной session. Выявить и устранить blocker.

### Этап 2. Error-doc insert при upload failure

Строки 607-611: при upload failure создается `results.push(...)` но НЕ создается запись в `ai_generated_documents`. Это значит batch теряет трассировку. Добавить insert error-doc аналогично строкам 545-559 и 579-593.

### Этап 3. Manifest parity proof (6 кейсов)

Сравнить `calculateServerManifest()` и `calculatePackageManifest()` по правилам включения. Оба файла уже содержат идентичные template arrays и conditional logic. Нужно формально задокументировать 1:1 совместимость по:

- составу шаблонов
- порядку
- included/excluded conditions
- legal_basis
- required_data

Зафиксировать в `docs/corporate-templates-rules.md`.

### Этап 4. Временное правило SoT по runtime_status

Frontend `corporateTemplateSpec.ts` = основной SoT. Server `DEFAULT_RUNTIME_STATUS` в `corporate-manifest.ts` = synchronized fallback. Документировать обязательное правило: любое изменение статуса должно делаться одновременно в обоих файлах до добавления DB-колонки.

### Этап 5. Runtime activation по proof

После успешного end-to-end теста: для каждого шаблона, который прошёл render + upload + DB record + download, перевести `pending_sprint3 → active` одновременно в:

- `corporateTemplateSpec.ts`
- `corporate-manifest.ts` `DEFAULT_RUNTIME_STATUS`

НЕ менять статус без полного proof (render OK + file uploaded + DB record + download works).

### Этап 6. Документация

Обновить `docs/corporate-templates-rules.md`:

- Proof manifest 1:1 (6 кейсов)
- Временное правило sync runtime_status
- Runtime activation matrix (заполнить по факту)

---

## Файлы


| Файл                                                        | Изменение                                |
| ----------------------------------------------------------- | ---------------------------------------- |
| `supabase/functions/ai-generate-corporate-package/index.ts` | Error-doc insert при upload failure      |
| `supabase/functions/_shared/corporate-manifest.ts`          | Sync runtime_status при activation       |
| `src/lib/corporate/corporateTemplateSpec.ts`                | Sync runtime_status при activation       |
| `docs/corporate-templates-rules.md`                         | Proof matrix, sync rule, manifest parity |


## DoD

1. Edge function deployed и вызвана successfully
2. Минимум 1 corporate batch end-to-end (render + upload + DB + download)
3. Error-doc insert при upload failure (трассировка не теряется)
4. Manifest parity proof задокументирован
5. Runtime activation matrix заполнена по фактическому proof
6. Временное правило sync runtime_status зафиксировано
7. Build clean