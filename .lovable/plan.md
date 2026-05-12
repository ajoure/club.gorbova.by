# да, согласен, с учетом правок:

## **1. Не делать финальный E2E smoke до пунктов 3 и 4**

Пункт 2 должен идти **после**:

- aliases `payer/service/order`;
- canonical numbering non-strict;
- Contact Center picker fix.

Иначе smoke придётся повторять.

Правильный порядок:

```text
6 → 1 → 4 → 3 → 2 → 7
```

Такой порядок у тебя внизу указан верно. Его и оставить.

---

## **2. Sprint C: уточнить имя функции**

Не писать заранее `generate-document`, если фактически non-strict путь находится в:

```text
supabase/functions/canonical-document-generate/index.ts
supabase/functions/_shared/document-render.ts
```

Формулировка:

```text
Найти фактический non-strict путь генерации и менять только его.
Предварительно ожидаемые файлы:
- canonical-document-generate/index.ts
- _shared/document-render.ts
```

---



## **3. Numbering: осторожно с**

`mode=generate`

Если сейчас smoke через `mode=generate` создаёт тестовые документы, после внедрения нумерации он начнёт расходовать реальные номера.

Добавить guard:

```text
Для smoke после Sprint C использовать mode=preview, если проверяется только рендер.
Для проверки sequence использовать отдельный controlled generate на тестовом шаблоне и одном тестовом order.
```

Иначе smoke будет двигать sequence лишний раз.

---





## **4.**

`allocate_document_number RPC` **не менять, но можно вызвать**

STOP-guard сформулировать точнее:

```text
RPC allocate_document_number не изменять.
Разрешено только подключить его вызов в non-strict generate path.
```

---

## **5. Aliases: не писать “FK на fields_registry.public_id”**

Нужно сначала проверить реальную схему. Раньше уже было видно, что связи могут идти через `field_id`, `token_key`, `canonical_token_key`, а не напрямую через `public_id`.

Исправить:

```text
Перед seed migration проверить схему:
\d document_token_registry
\d fields_registry
\d document_token_aliases

Seed делать строго по фактическим FK/constraints.
```

---













## **6. Aliases:**

`payer.*`**,** `service.*`**,** `order.*` **делать как aliases, не как новые источники**

Правильно:

```text
payer.* → customer.*
service.* → deal.*
order.* → deal/order existing values
```

Не добавлять отдельную новую логику выборки данных.

---

## **7. Contact Center picker bugfix — согласен, но указать как temporary compatibility**

Так как `CONTACT_TOKENS` уже deprecated, лучше оформить так:

```text
Временно расширить CONTACT_TOKENS canonical contact.* aliases для корректного label existing chip renderer.
Долгосрочно — tokenStringToLabel должен брать label из registry refs.
```

То есть сейчас можно быстро закрыть баг через `CONTACT_TOKENS`, но не считать это финальной архитектурой.

---





## **8. По**

`case=...` **в picker**

Добавить конкретную правку:

```text
В messages-контексте FieldPickerPopover уже simple=true.
Проверить, что step format/case не показывается для Contact Center.
Если где-то case=... доступен в messages — скрыть.
```

Для DOCX можно пока оставить, если renderer не применяет — но не включать в smoke.

---

## **9. В final smoke не требовать морфологию**

В smoke после всех правок включить:

- `payer.*`;
- `service.*`;
- `order.*`;
- `payment.*`;
- адреса;
- document number.

Не включать:

```text
|case=genitive
```

---

## **10. В финальный отчёт добавить отдельный блок “что НЕ закрыто”**

Обязательно:

```text
Deferred:
- morphology / case modifiers;
- possible registry-driven label renderer вместо CONTACT_TOKENS;
- global cleanup legacy document_defaults после отдельного dry-run;
- full CI regression.
```

---

## **Итоговая команда**

```text
План согласован.

Реализуй строго в порядке:

1. Bugfix Contact Center picker label для contact.*.
2. UI cleanup proof.
3. Alias discovery + seed + renderer alias-layer для payer/service/order.
4. Canonical numbering для non-strict path.
5. Финальный DOCX/PDF smoke.
6. Финальный отчёт.

Не расширять scope.
Не трогать payments_v2, orders_v2 schema, document scenarios storage.
RPC allocate_document_number не менять, только использовать.

План: закрыть остаточные хвосты по документам и picker-токенам
```

Принцип: только перечисленные пункты, без расширения scope. STOP-guards: `payments_v2`, `orders_v2 schema`, `allocate_document_number RPC`, `document scenarios storage` — не трогаем.

---

## 1. UI cleanup proof (вкладка «Документы»)

Только проверка, без правок:

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `rg` по `OfferDocumentDefaultsCard.tsx` — нет `Шаблон акта`, `Показывать технические ID`, `executorPreselectRef`, `document_defaults.template_id/executor_id`.
- `rg` по `OfferDocumentScenariosCard.tsx` — есть `Шаблон документа`, `Исполнитель`, warnings `Не выбран шаблон/исполнитель`.

DoD: три проверки чистые, в отчёт включаю вывод rg/tsc.

---

## 2. Финальный E2E DOCX/PDF smoke

Один итоговый прогон через `generate-document` (mode=generate) + PDF на боевом order с юрлицом-плательщиком (Панфилова, 2, 49л, Минск).

Проверяемые группы токенов: `document.*`, `system.*`, `customer.*`, `executor.*`, `deal.*`, `payment.*`, `customer.address`, `executor.address`, `customer.address.full`, `executor.address.full`.

Ожидаемо:

- DOCX и PDF создаются.
- `unresolved_count = 0`, в PDF нет `{{...}}`.
- `payment.*` заполнены (метод, дата).
- Адрес: `ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь`.
- Для Минска нет `Центральный район / Минский район / Минская область`.

Proof: `ai_generated_documents.id`, `template_version_id`, `order_id`, `docx_check`, `source_trace`, `warnings_snapshot`, ссылка на DOCX/PDF.

---

## 3. Sprint C — canonical numbering для non-strict renderer

Проблема: non-strict путь генерит `AKT-260512-155` (random), strict уже использует `allocate_document_number`.

Изменения:

- В non-strict ветке `generate-document` (там, где сейчас формируется random номер): при `mode=generate` вызывать существующий `allocate_document_number` RPC (не менять сам RPC).
- При `mode=preview` (и smoke preview) — НЕ дёргать RPC, формировать явный временный номер `PREVIEW-DDMM` (или `PREVIEW-{shortId}`), помечать `meta.preview=true`.
- Idempotency: повторный generate с тем же `idempotency_key` не должен расходовать новый номер — переиспользовать сохранённый из `ai_generated_documents`.

STOP: не менять RPC, не ломать strict, preview не пишет в numbering sequence.

DoD:

- generate двигает sequence ровно на 1 (proof: `select last_value` до/после).
- preview не двигает sequence.
- В сгенерированном PDF generate — канонический номер; в preview — `PREVIEW-...`.
- `deno check` по затронутым функциям clean.

---

## 4. Aliases: `payer.*`, `service.*`, `order.*`

Discovery первым шагом:

- `select token_key from document_token_registry where token_key like 'payer.%' or like 'service.%' or like 'order.%'`.
- Для отсутствующих токенов — seed migration в `document_token_registry` (FK на `fields_registry.public_id` уже существующих canonical полей; runtime alias только если registry-записи есть).

Alias-mapping (read-only layer в `_shared/document-render.ts`, после основного резолва):

```
payer.name|short_name|unp|address|email|phone|passport → customer.*
service.name|quantity|unit_price|amount               → deal.service_name|quantity|unit_price|amount
order.number|amount|currency|paid_at                  → deal.id|amount|currency|paid_at
```

DoD:

- Aliases есть в `document_token_registry` (миграция).
- Резолвятся в renderer через alias-таблицу (без дублирования логики получения данных).
- Smoke DOCX/PDF включает `payer.*`/`service.*`/`order.*` → `unresolved_count = 0`.

---

## 5. Морфология / падежи — deferred

Не делаем. Фиксирую как backlog:

- В picker НЕ показывать `case=...` модификаторы как рабочие, пока renderer не поддерживает.
- В smoke `case=genitive` НЕ обязательный proof.
- Backlog: выбор morph engine, список сущностей, fallback без падежа, proof на ФИО/компаниях.

---

## 6. Bugfix: Contact Center picker — `UNMAPPED · contact.last_name`

Корень: `CONTACT_TOKENS` в `src/lib/tokens/tokenRegistry.ts` (строки 78–85) содержит только legacy unprefixed (`{{last_name}}`, `{{full_name}}`, ...). Picker вставляет canonical `{{contact.last_name}}` → `tokenStringToLabel()` возвращает `null` → chip рендерится как `UNMAPPED · contact.last_name`.

Fix:

- Расширить `CONTACT_TOKENS` каноническими alias-записями (`contact.full_name`, `contact.first_name`, `contact.last_name`, `contact.email`, `contact.phone`, `contact.telegram_username`) с теми же label/group/badge.
- Legacy `{{full_name}}` и др. оставить как есть (для совместимости со старыми сообщениями).
- Resolver в edge-функциях не трогаем — он уже принимает canonical через `resolveContactTokens()`.
- Красный UNMAPPED стиль остаётся только для реально unsupported токенов.

DoD:

- Через `[` в Контакт-центре выбрать «Фамилия» → chip `Фамилия` (или `Контакт · Фамилия`), не красный.
- Saved value = `{{contact.last_name}}`, при отправке резолвится корректно.
- Unsupported tokens по-прежнему disabled/красные.
- `tsc` clean.

Proof: скриншот до/после в чате, плюс мини-ручной test через session replay.

---

## 7. Финальный отчёт

В разделе «Отчёт о выполнении»:

- Что закрыто (1, 2, 3, 4, 6).
- Что deferred (5: морфология; всё, что вне scope).
- Список изменённых файлов.
- Proof: tsc/deno check, sequence до/после, smoke DOCX/PDF (id+ссылки), скриншот picker до/после.
- Подтверждение, что не трогались: `payments_v2`, `orders_v2 schema`, `allocate_document_number` RPC, document scenarios storage.

---

## Технические детали (для агента)

- Файлы под правки:
  - `supabase/functions/generate-document/index.ts` (или non-strict путь — точное место уточню при выполнении): canonical numbering branch.
  - `supabase/functions/_shared/document-render.ts`: alias-layer payer/service/order.
  - Новая миграция: `document_token_registry` seed для payer/service/order alias-токенов.
  - `src/lib/tokens/tokenRegistry.ts`: дополнить `CONTACT_TOKENS` каноническими `contact.*` записями.
- Порядок: 6 (быстрый bugfix) → 1 (proof) → 4 (discovery+seed+alias) → 3 (numbering) → 2 (финальный smoke, покрывает 4 и 3) → 7 (отчёт).