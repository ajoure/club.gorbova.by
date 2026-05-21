Да, согласен, с учетом правок:

1. **PATCH-A и PATCH-B делать раздельными коммитами/отчётами внутри одного спринта.**  
Причина: PATCH-A — правила доступа и безопасность `/purchases`; PATCH-B — шаблоны имени файла и миграция. Если один сломается, второй не должен быть смешан в откате.
2. **В A.1 не писать “зеркальную копию helper” вручную с риском расхождения.**  
Лучше:
  &nbsp;
  &nbsp;
  - frontend helper: `src/lib/documents/purchaseDocumentRules.ts`;
  - backend helper: `supabase/functions/_shared/purchase-document-rules.ts`;
  - в proof обязательно приложить одинаковые test-cases для обоих helper’ов.  
  Полностью общий файл между Vite и Deno может быть проблемным из-за импортов, поэтому допустима дубликация, но только с одинаковыми тестами и контрактом.
3. `hasRealSucceededPayment` **должен исключать не только** `admin_test`**, но и любые internal/test providers.**  
Добавить allowlist/denylist:
  ```ts
  real providers: bepaid / bepaid_card / bepaid_erip / provider values actually used by production
  excluded: admin_test, admin_test_direct, manual, virtual, internal_test
  ```
  Сначала discovery по фактическим `payments_v2.provider`.
4. **В A.3 backend hard-stop не должен блокировать админа в админке по умолчанию, если это существующий admin-flow.**  
Для `/purchases` self-service — строгие guards.  
Для админки — либо `admin_force=true`, либо отдельный admin endpoint/ветка. Важно не сломать ручную генерацию документов в карточке сделки.
5. **В A.4 добавить проверку “existing doc + no current rules”.**  
Уже указано частично, но зафиксировать явно: если документ был создан раньше, пользователь может скачать его всегда, даже если офер позже выключили.
6. **PATCH-B: SOT лучше выбрать** `document_templates.file_name_template` **как default, но сразу проверить, нет ли уже version-level metadata.**  
Если `document_template_versions.meta` уже содержит настройки шаблона, не добавлять поле в versions без необходимости.  
Минимальный безопасный вариант: `document_templates.file_name_template`, snapshot при генерации обязателен.
7. **В B.3 “обязателен FLD номера документа” — сначала определить точный FLD номера.**  
Не хардкодить. В discovery найти по registry:
  - `document.number`;
  - либо текущий canonical token для номера документа.  
  В proof указать конкретный `FLD-XXXXXX`.
8. **Если номер документа создаётся только при generate, preview имени файла должен использовать preview-number.**  
В UI preview для имени файла показывать тестовое значение, например:
  &nbsp;
  ```text
  PREVIEW-0001
  ```
  Но в реальной генерации использовать настоящий canonical number.
9. **В B.4 unresolved FLD в имени файла не должен silently исчезать без видимого proof.**  
Сохранять:
  &nbsp;
  ```ts
  meta.file_name_warnings[]
  ```
  и в admin UI/истории документа показывать предупреждение, если имя было собрано с пустыми значениями.
10. **В B.5** `document-download` **не должен принудительно делать** `attachment` **для PDF, если сейчас PDF открывается inline.**  
Нужно сохранить текущую UX-логику:

&nbsp;

- «Просмотр PDF» → `inline`;
- «Скачать PDF» → `attachment`;
- DOCX → `attachment`.  
Но имя файла в обоих случаях берётся из `ai_generated_documents.file_name`.

11. `canonical-document-send` **не должен генерировать документ в PATCH-B.**  
Он только использует уже сохранённое `file_name`. Генерация/идемпотентность — из PATCH-A.
12. **Добавить проверку, что** `file_name_template` **не содержит расширение.**  
Если админ ввёл `.pdf` или `.docx`, либо убрать, либо validation warning:

```text
Расширение добавляется автоматически, не указывайте .pdf/.docx в шаблоне имени.
```

13. **Не применять** `file_name_template` **к legacy** `generated_documents`**, если они не идут через canonical pipeline.**  
Только `ai_generated_documents` / выбранная SOT-таблица canonical documents. Legacy — read-only compatibility.
14. **В DoD PATCH-A добавить grep-proof по legacy-функциям именно внутри** `/purchases`**.**  
Не требовать полного удаления вызовов по всему проекту, если они ещё нужны в других админских/legacy местах.
15. **В итоговом отчёте обязательно указать, что production-шаблоны не получили автоматический** `file_name_template`**.**  
Это важно, чтобы не было массового изменения поведения.

Готовый блок для Lovable:

```text
Дополни план правками:

1. PATCH-A и PATCH-B выполнить как два независимых блока внутри одного спринта: отдельные diff-summary, proof и rollback-notes.

2. Для purchaseDocumentRules frontend/backend допускается два файла, но контракт и test-cases должны быть одинаковыми. В proof приложить одинаковые тесты для UI-helper и Deno-helper.

3. hasRealSucceededPayment строить после discovery фактических payments_v2.provider. Исключить admin_test/admin_test_direct/manual/virtual/internal_test. Реальными считать только production-provider values, подтверждённые в БД.

4. Backend hard-stop строго применяется к self-service /purchases. Admin generation не ломать: admin bypass только через явный admin_force=true или существующий admin-flow, с audit document.admin_force_generate.

5. Existing canonical document всегда можно скачать, даже если после генерации офер выключили или правила документа стали недоступны. Запрещено только «Сформировать новый».

6. По file_name_template сначала определить SOT: document_templates.file_name_template или document_template_versions. Если нет сильной причины для version-level, использовать document_templates.file_name_template как default, но snapshot обязателен.

7. В discovery определить точный FLD номера документа через fields_registry/document_token_registry. Не хардкодить. Validation требует именно этот FLD номера.

8. UI-preview имени файла использует preview-number, но generate использует настоящий canonical document_number.

9. Если FLD в имени файла не разрешился, финальное имя не должно содержать {{...}}. Значение пустое, warning сохраняется в ai_generated_documents.meta.file_name_warnings и виден в admin history.

10. document-download должен сохранять UX:
- Preview/Open PDF = inline;
- Download PDF = attachment;
- DOCX = attachment.
Во всех случаях filename берётся из ai_generated_documents.file_name + нужное расширение.

11. В file_name_template запретить ввод .pdf/.docx в конце: расширение добавляет система автоматически.

12. canonical-document-send только использует сохранённое file_name для email/Telegram attachment. Не добавлять там отдельную генерацию имени.

13. file_name_template применять только к canonical documents SOT. Legacy generated_documents не менять, только read-only compatibility.

14. Grep-proof по legacy generate-invoice-act/send-invoice/generate-document-pdf делать именно для клиентского /purchases flow, а не требовать удаления по всему проекту.

15. В финальном отчёте явно подтвердить: production-шаблоны не получили file_name_template автоматически; заполнение имени файла — только вручную админом.

План: два независимых PATCH в одном спринте. Отдельные proof-блоки, общий shared-helper.
```

```
PATCH-A: purchases document availability rules
PATCH-B: document file_name_template (FLD-first canon)
```

---

# PATCH-A. Правила доступности «Сформировать» и «Чек» в `/purchases`

## A.0. Целевые правила (как должно быть)

1. **«Сформировать документ»** видна ТОЛЬКО когда одновременно:
  - есть реальный успешный bePaid-платёж (см. A.2),
  - у купленного офера документ реально включён (см. A.3).
2. **«Скачать чек bePaid»** видна ТОЛЬКО когда есть реальный платёж с валидным `receipt_url` (см. A.4). Заменитель/виртуальный чек НЕ генерируется.
3. **Скачивание уже существующего canonical-документа** доступно всегда, когда `ai_generated_documents` для заказа существует (даже если правила A.1 сейчас не выполняются). «Сформировать новый» в этом случае — нельзя.
4. Искусственный/manual-заказ без `payments_v2.succeeded`: ни «Чек», ни «Сформировать», ни «Сформировать новый».

## A.1. Shared helper (общая правда UI и backend)

Новый модуль `src/lib/documents/purchaseDocumentRules.ts` + зеркальная копия `supabase/functions/_shared/purchase-document-rules.ts` (deno-совместимая). Backend и frontend используют один и тот же контракт; запрещено иметь две разные реализации правил.

Экспортируемые pure-функции:

- `getOrderOfferId(order): string | null` — резолв в порядке:
  ```
  order.offer_id
    ?? order.meta?.offer_id
    ?? order.meta?.crm_routing_snapshot?.offer_id
    ?? order.meta?.document_data?._provenance?.offer_id
    ?? null
  ```
- `resolveOfferForOrder({ order, tariffOffers })` →
`{ offer, source: 'order_offer' | 'single_active_tariff_offer' | 'none', reason? }`.
Fallback на активный оффер тарифа РАЗРЕШЁН ТОЛЬКО если у тарифа ровно один `is_active=true` оффер. Иначе `source='none'` + `reason='multiple_or_zero_active_offers'` → STOP.
- `hasRealSucceededPayment(payments_v2): boolean` —
  ```
  payments_v2.some(p =>
    p.status === 'succeeded'
    && p.provider !== 'admin_test'
    && p.provider !== 'admin_test_direct'
  )
  ```
- `getValidReceiptUrl(payment): string | null` —
  ```
  payment.receipt_url
    ?? payment.provider_response?.transaction?.receipt_url
    ?? null
  ```
  Пустые строки/null → `null`.
- `isOfferDocumentEnabled(offerMeta, { payerType, paymentChannel })` →
`{ enabled: boolean, template_id: string | null, source: 'scenario' | 'defaults' | 'none', reason?: 'no_offer' | 'no_template' | 'disabled' }`.
Правила:
  - найден matching enabled `document_scenarios[]` с непустым `template_id` → `enabled=true`, source=`scenario`;
  - иначе если `document_defaults.generate_act === true` И `document_defaults.template_id` непустой → `enabled=true`, source=`defaults`;
  - если `generate_act=true`, но `template_id` пустой → `enabled=false`, `reason='no_template'` (UI покажет «Документ не настроен»);
  - иначе `enabled=false`, `reason='disabled' | 'no_offer'`.
- `canGenerateDocument(order, payments, offerMeta, ctx)` — композиция выше: true только если `hasRealSucceededPayment` И `isOfferDocumentEnabled.enabled`.

Любая «угадайка» (heuristics по product_code/имени тарифа/строкам meta) — запрещена.

## A.2. Frontend (`/purchases`)

Файл `src/components/purchases/OrderListItem.tsx` (+ subscription sheet):

- Удалить локальный `hasRealPayment = isPaid && payments_v2.length>0`.
- Использовать `hasRealSucceededPayment(order.payments_v2)`.
- Резолв офера через `getOrderOfferId` → подтянуть `tariff_offers` (уже грузится в `useTariffOffers`); если нет — `resolveOfferForOrder` пытается single-active fallback.
- `isOfferDocumentEnabled` с `payerType` из `order.meta.payer_type` и `paymentChannel` из `derivePaymentChannel`.
- Рендер:
  - есть existing `primaryDoc` из `useOrderCanonicalDocuments` → показывать «Скачать документ» (и «Скачать DOCX» если mime=docx) независимо от A.1/A.3;
  - нет документа + `canGenerate` → «Сформировать документ»;
  - нет документа + `hasRealSucceededPayment` + offer disabled с `reason='no_template'` → строка «Документ не настроен» (без кнопки);
  - нет документа + offer disabled по другой причине → ничего из секции документов;
- «Чек bePaid»: показывать только если `getValidReceiptUrl(p) !== null` хотя бы для одного `p` с `hasRealSucceededPayment`. Не показывать ни для admin_test, ни при пустом url. Виртуальная квитанция (`receiptGenerator.ts`) скрыта при наличии реального чека и не подменяет его.

## A.3. Backend hard-stop в `canonical-document-generate-strict`

Self-service ветка (не admin):

1. Загрузить `payments_v2` по `order_id`. Если `hasRealSucceededPayment === false` → `403 no_real_payment`, audit `document.generate_blocked_no_payment`.
2. Через `getOrderOfferId` + `resolveOfferForOrder` (single-active fallback) получить offer. Если `source='none'` → `409 offer_unresolved` с reason, audit `document.generate_blocked_offer_unresolved`.
3. `isOfferDocumentEnabled(offer.meta, { payerType, paymentChannel })`:
  - `reason='no_template'` → `409 document_template_not_configured`;
  - `enabled=false` иначе → `403 document_not_enabled_for_offer`;
  - `enabled=true` → берём `template_id` и продолжаем.
4. Admin-путь:
  - срабатывает только при явном `admin_force === true` И вызывающий — `super_admin/admin`;
  - guards A.3.1–A.3.3 НЕ обходятся молча: они выполняются и при провале возвращают warnings, которые сохраняются в `audit_logs` (`action='document.admin_force_generate'`, `meta={ skipped_guards: [...], offer_source, payment_status }`) и в `ai_generated_documents.meta.admin_force = { reason, skipped_guards }`;
  - UI админки помечает такой документ бейджем «Создан вручную вне правил оффера».

Удалить текущий «угадывающий» fallback на ЛЮБОЙ активный оффер тарифа — заменить на helper из A.1 (строго single-active).

## A.4. Verify PATCH-A

Proof: `.lovable/proofs/patch_a_purchases_rules.md`. Сценарии:

1. Real succeeded + offer.generate_act+template_id → «Сформировать» работает, документ создаётся.
2. Real succeeded + matched enabled scenario с template_id → «Сформировать» работает.
3. Real succeeded + valid receipt_url → «Чек» виден.
4. Real succeeded + offer без документа → видна только «Чек», «Сформировать» нет.
5. Real succeeded + generate_act=true + template_id пустой → строка «Документ не настроен», без кнопки; backend на прямой вызов отдаёт `409 document_template_not_configured`.
6. Order без `payments_v2.succeeded` (или только admin_test) → нет «Чек», нет «Сформировать», backend → `403 no_real_payment`.
7. Order виртуальный, но уже есть canonical-документ → «Скачать документ» видно, «Сформировать новый» отсутствует, «Чек» отсутствует.
8. У тарифа 2+ активных оффера, у заказа `offer_id=NULL` → backend `409 offer_unresolved`, UI показывает «Документ не настроен».
9. Admin без `admin_force` → ведёт себя как self-service (получает 403/409). Admin с `admin_force=true` → документ создаётся, в audit зафиксированы `skipped_guards`.

---

# PATCH-B. `file_name_template` (FLD-first canon)

## B.0. Канон

Имя файла документа использует **тот же синтаксис плейсхолдеров, что DOCX**: только `{{field:FLD-XXXXXX}}`. Никаких новых alias (`{{payer_short_name}}`, `{{amount}}`, `{{document_date_iso}}`, `{{order_number}}` и пр.). Все значения берутся из того же resolved token map (`orders_v2.meta.document_data.fields` / `token_manifest_snapshot`), который используется для рендера DOCX/PDF. Это сохраняет совместимость с `field-id-first-canon` (см. `.lovable/memory/architecture/documents/field-id-first-canon.md`) и не вводит второй стандарт.

## B.1. Discovery (обязательный шаг перед миграцией)

Proof: `.lovable/proofs/patch_b_file_name_template_discovery.md`.

1. Прочитать структуру `document_templates` и `document_template_versions`, понять, версионируется ли тело шаблона per-version и где сейчас хранятся per-version настройки.
2. Зафиксировать решение SOT:
  - **Вариант 1 (по умолчанию):** `document_templates.file_name_template` — общий дефолт для всех версий шаблона; per-version override опционален позже.
  - **Вариант 2:** `document_template_versions.file_name_template` — если в реальности per-version отличаются метаданные (формат даты/номера).
3. В обоих вариантах при генерации **обязателен snapshot** в `ai_generated_documents`:
  - `file_name` — рендеренное имя;
  - `meta.file_name_template_snapshot` — исходная строка шаблона;
  - `meta.file_name_template_source` — `template` | `template_version` | `system_default`;
  - `meta.file_name_warnings[]` — unresolved плейсхолдеры.
   Это гарантирует, что изменение шаблона в админке не переименовывает исторические документы.

После discovery — миграция строго по выбранному варианту, не вслепую.

## B.2. Контракт плейсхолдеров

- Допустимо только: `{{field:FLD-XXXXXX}}`.
- Значения резолвятся через тот же helper, что строит token map для DOCX (`aiDocumentSnapshotResolver` / `resolved_tokens`). Никаких параллельных alias-резолверов.
- Дата: используется **существующий FLD даты документа** из registry. Формат даты в этом патче НЕ меняется — он определяется тем, как этот FLD рендерится в текущей pipeline. `document_date_iso` НЕ вводится.
- Номер документа: используется существующий FLD номера документа из registry.
- Точные `FLD-*` для номера/даты/ФИО плательщика/наименования исполнителя определяются в discovery через `fields_registry` + `document_token_registry` и фиксируются в proof.

## B.3. Validation шаблона имени (UI + backend)

В UI редактирования шаблона (`AdminProductsDocs` → шаблоны документов):

- Текстовое поле `file_name_template` + chips-каталог доступных FLD (читается из `fields_registry`, тех же что доступны для DOCX данного шаблона).
- Live-preview по фейковому token map.
- **Hard validation на save:**
  - любой `{{...}}` не матчащий `^\{\{field:FLD-[0-9]+\}\}$` → ошибка «Использовать можно только плейсхолдеры формата `{{field:FLD-XXXXXX}}`»;
  - шаблон обязан содержать FLD номера документа (whitelist FLD-ID номера фиксируется в discovery) → иначе ошибка «Добавьте плейсхолдер номера документа, чтобы имя файла было уникальным»;
  - запрещённые символы `/ \ : * ? " < > |` в литералах шаблона допустимы (мы их санитизируем при рендере), но в preview сразу показываем санитизированный вид.
- Кнопка «Сбросить к системному дефолту».
- Производственные шаблоны не получают `file_name_template` автоматически. Заполнение — только вручную админом. STOP: миграция НЕ проставляет дефолтные значения существующим строкам.

## B.4. Backend `renderFileName`

Новый модуль `supabase/functions/_shared/document-filename.ts` (pure, без БД):

- `renderFileName(templateString, resolvedTokens, ctx)` →
`{ name: string, warnings: string[] }`.
- Резолв ТОЛЬКО `{{field:FLD-XXXXXX}}` через переданный resolved token map (тот же, что для DOCX/PDF).
- Unresolved/неизвестный FLD → подставляется пустая строка + warning `file_name_placeholder_unresolved:FLD-XXXXXX`. Никогда не оставлять `{{...}}` в финальном имени.
- Любой плейсхолдер не FLD-формата → warning `file_name_placeholder_invalid_syntax:<raw>` + пусто (на backend; UI обязан не пропускать такое).
- **Санитизация:**
  - запрещённые символы `/ \ : * ? " < > |` → `-` (важно: `document_number` `2105/1` → `2105-1`);
  - control chars (`\u0000-\u001F`) → удалить;
  - схлопнуть повторные пробелы и пробелы вокруг разделителей;
  - trim;
  - max length 180 символов (UTF-8 safe truncate);
  - пустой результат → fallback на системный дефолт `«{template.name} № <doc_number_or_id> от <created_at_date>»` (тоже санитизированный).
- Расширение (`.pdf`/`.docx`) добавляется потребителем, не из шаблона.

Интеграция в `canonical-document-generate-strict`:

- после успешной генерации читать `file_name_template` по выбранному SOT;
- собрать `resolvedTokens` (тот же snapshot, что писали в `document_data.fields`);
- сохранить `file_name` + `meta.file_name_template_snapshot` + `meta.file_name_warnings` в `ai_generated_documents`.

## B.5. Применение имени везде на выдаче

- `supabase/functions/document-download/index.ts`:
  - использовать `ai_generated_documents.file_name`;
  - расширение по `kind`: `.pdf` для PDF, `.docx` для DOCX;
  - `Content-Disposition: attachment; filename*=UTF-8''<rfc5987-encoded(name+ext)>` + ASCII-fallback `filename="..."` (для кириллицы — без ByteString-ошибок);
  - НЕ брать имя из storage `file_path`.
- `supabase/functions/canonical-document-send/index.ts`:
  - email attachment filename = `ai_generated_documents.file_name + ext` (не `document.pdf`);
  - Telegram `sendDocument` `filename` = то же; не отдавать технический storage name.
- Storage path остаётся техническим UUID — допускается одинаковое человекочитаемое имя для разных файлов в storage, конфликты разруливает UUID.

## B.6. Verify PATCH-B

Proof: `.lovable/proofs/patch_b_file_name_template.md`.

- **Discovery proof:** зафиксирован SOT (templates vs versions) и точные FLD номера/даты/ФИО/исполнителя.
- **Validation:**
  - сохранение `file_name_template` с `{{payer_short_name}}` или `{{amount}}` → ошибка validation (UI + при прямом API);
  - сохранение без FLD номера документа → ошибка «Добавьте плейсхолдер номера документа…»;
  - сохранение `Счёт-акт {{field:FLD-XXX}} — {{field:FLD-YYY}} — {{field:FLD-ZZZ}}` → ok.
- **Рендер:**
  - `document_number='2105/1'` → в имени `2105-1`;
  - кириллица: скачивание отдаёт файл с именем вида
  `Счёт-акт 2105-1 — Федорчук С.В. — ЗАО АЖУР инкам.pdf`
  без ByteString-ошибок и без `*.supabase.co` в пользовательском URL;
  - DOCX-вариант того же документа: `... .docx`, имя совпадает с PDF до расширения;
  - unresolved FLD → пусто в имени + warning в `meta.file_name_warnings`;
  - пустой результат после санитизации → fallback на системный дефолт.
- **Email/Telegram:**
  - письмо с attachment имеет это же имя файла;
  - Telegram `sendDocument` показывает это же имя.
- **Snapshot:** изменение `file_name_template` после генерации НЕ переименовывает уже выданный документ (читается `meta.file_name_template_snapshot` для исторических — для регенерации, не для скачивания).
- **Production safety:** существующие production-шаблоны имеют `file_name_template IS NULL` после миграции, ведут себя как раньше (системный дефолт) до ручного заполнения админом.

---

## Что НЕ делается в этом спринте

- Не меняется формат DOCX-плейсхолдеров и не вводится никаких alias.
- Не меняется формат даты документа в теле (только используется существующий FLD даты).
- Не трогается legacy `generated_documents` (только чтение).
- Не вводятся новые edge-функции и таблицы кроме одной мини-миграции по B.1.
- Production-шаблонам `file_name_template` не проставляется автоматически.

## DoD (общий)

PATCH-A:

- Правила A.0 выполняются 1:1 (UI + backend), backend и UI используют один shared helper.
- Backend возвращает осмысленные коды: `no_real_payment`, `offer_unresolved`, `document_not_enabled_for_offer`, `document_template_not_configured`.
- Admin force-generate только при `admin_force=true` + audit с `skipped_guards`.
- Proof по реальной выборке + все 9 сценариев из A.4.

PATCH-B:

- Discovery выбрал SOT (templates vs versions) и зафиксирован в proof.
- В шаблоне имени допустим ТОЛЬКО `{{field:FLD-XXXXXX}}`; alias-плейсхолдеры запрещены validation'ом.
- Обязателен FLD номера документа в шаблоне.
- `document_number` с `/` санитизируется в `-`; запрещённые символы → `-`; пустой результат → fallback.
- Имя применяется и в download, и в email, и в Telegram; кириллица работает; без ByteString и `*.supabase.co` в UI.
- Snapshot в `ai_generated_documents.meta.file_name_template_snapshot` гарантирует, что исторические документы не переименовываются.
- Production-шаблоны не модифицируются автоматически.