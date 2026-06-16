## да, согласен, с учетом правок:

1. **Исправить источник package-binding в A5.** Использовать фактическую существующую связь через `document_package_template_items` и связанный `document_template_id`/`template_version_id`, а не неопределённую `document_package_items`.
2. **Не считать произвольный** `meta.package_bound=true` **достаточным источником истины.** Package-context должен подтверждаться доказуемой DB-связью шаблона с пакетом. `meta.package_bound` допустим только как серверно управляемая проекция, но не как самостоятельный bypass контекстного гейта.
3. **Устранить остаточное дублирование shared classifier.** Два вручную поддерживаемых файла:
  &nbsp;
  ```text
  src/lib/documents/placeholderClassifier.ts
  supabase/functions/_shared/placeholderClassifier.ts
  ```
  всё ещё могут разойтись. Предпочтительно:
  - один portable shared-модуль, импортируемый frontend и edge; либо
  - generated mirror с обязательным parity/hash-тестом, который падает при расхождении.
  Одинаковых наборов unit-тестов недостаточно для гарантии идентичности реализации.
4. **Зафиксировать разделение ошибок модификаторов:**
  - неизвестный ключ, например `hello=world` → `unknown_modifier`;
  - известный ключ с недопустимым значением, например `format=potato` → `invalid_modifier_value`;
  - при преобразовании в пользовательский код ошибки для `pf-` оба случая могут отображаться как `pf_unsupported_modifier`, но внутренняя классификация должна оставаться точной.
5. **Контекстный gate выполнять до активации и сохранения active-версии.** При `package_token_outside_package_context` edge не должен:
  - устанавливать `is_active=true`;
  - создавать активную template version;
  - изменять предыдущую рабочую версию;
  - сохранять частично обновлённый manifest.
6. **D1 должен подтверждать именно существующую DB-привязку шаблона к пакету**, а не только факт нахождения `pf-` в DOCX. В proof приложить идентификаторы:
7. **Для datetime не использовать “ISO без сдвига зоны” без точного контракта.** Зафиксировать фактический storage-формат:
  - либо `timestamptz` в UTC с вычислением anchor в `Europe/Minsk`;
  - либо локальная строка без timezone, если именно это ожидает существующий RPC.
  UI, RPC, resolver и snapshot должны использовать один формат без повторного timezone-shift.
8. **В D7 дополнительно проверить modifiers в реальном DOCX**, минимум один форматированный токен:
  &nbsp;
  ```text
  {{pf-000002|format=full}}
  ```
  Это одновременно докажет, что новый shared classifier не только пропускает базовый `pf-`, но и корректно передаёт canonical modifiers в генератор.

Все остальные ранее выданные замечания внесены. После этих уточнений план готов к выполнению.

&nbsp;

Контекст

Два связанных дефекта PATCH-PACKAGE-CUSTOM-FIELDS-V1:

1. Strict-валидаторы шаблонов (`StrictDocumentTemplatesManager.tsx` + `canonical-template-apply-markup`) не знают про токен `{{pf-XXXXXX}}` и маркируют его `legacy_placeholder_format_detected`. Шаблон «1. Приказ о проведении годового общего собрания участников ООО» висит в `invalid`. `PackageTemplateValidationPanel` (package-context) уже распознаёт `pf-` через локальный `RX_PACKAGE_FIELD_PF` — фронт и edge разошлись.
2. В диалоге «Новое поле пакета» для типов date/datetime/year выпадающий «Значение по умолчанию» содержит только anchor-варианты текущего периода. Нужно добавить относительные сдвиги «прошлый / текущий / будущий» для месяца, квартала и года.

---

## Часть A — Канонизировать `pf-XXXXXX` через shared classifier (anti-divergence)

### A1. Сначала аудит существующих парсеров (без правок) {#anti-divergence-audit}

Уже существует 4 точки знания о синтаксисе токенов — их **нельзя множить дальше**:


| Файл                                                                                                   | Что знает                                                    | Что НЕ знает |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------ |
| `src/components/ai-documents/TemplateMarkupDialog.tsx` (`classifyTemplateToken`, `MOD_TAIL`)           | field, package.ul/ip/fl, ln, legacy PKR/roles, scope=billing | pf           |
| `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (`parseStrictInside`, локальные RX_*) | field, package.ul/ip/fl, ln, legacy                          | pf           |
| `supabase/functions/canonical-template-apply-markup/index.ts` (`parseStrictToken`, локальные RX_*)     | field, package.ul/ip/fl, ln, legacy                          | pf           |
| `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` (`RX_PACKAGE_FIELD_PF`)      | pf (uses it)                                                 | —            |


Никаких дублирующих regex добавлять не будем. Вместо этого вводим **один shared helper** — единый источник истины синтаксиса и модификаторов.

### A2. Новый shared helper `src/lib/documents/placeholderClassifier.ts` (и его mirror в `supabase/functions/_shared/placeholderClassifier.ts`)

Чистая функция, без I/O и без зависимости от Supabase:

```ts
export type PlaceholderKind =
  | { kind: 'field';         public_id: string; format: Format|null; case_modifier: Case|null }
  | { kind: 'package_field'; public_id: string; format: Format|null; case_modifier: Case|null } // pf-XXXXXX
  | { kind: 'package_role';  public_id: string; format: Format|null; case_modifier: Case|null } // ln-XXXXXX
  | { kind: 'package_requisite'; entity: 'ul'|'ip'|'fl'; public_id: string; format; case_modifier }
  | { kind: 'legacy_role_format' }
  | { kind: 'legacy_namespace' }   // document.*/executor.*/customer.*/deal.*/cf.*
  | { kind: 'unknown_modifier'; modifier: string }
  | { kind: 'invalid_modifier_value'; value: string }
  | { kind: 'invalid' };

export type PlaceholderScope = 'billing' | 'package' | 'unknown';

export function classifyPlaceholder(inside: string): PlaceholderKind;
export function evaluatePlaceholderInScope(
  inside: string,
  scope: PlaceholderScope,
): { valid: boolean; reason?: string; classification: PlaceholderKind };
```

`evaluatePlaceholderInScope` ровно фиксирует **синтаксис ≠ контекст**:

- `billing` scope: валидны только `field`. Любой package/ln/pf → `reason: 'package_token_outside_package_context'` (новый код).
- `package` scope: валидны field, package.ul/ip/fl, ln, **pf**.
- `unknown` (legacy путь активации без явного binding): package/ln/pf трактуются как **syntactically valid, contextually unresolved** — UI рисует chip, но `canonical-template-apply-markup` дополнительно проверяет что шаблон будет привязан к пакету (см. A4).

Модификаторы для pf парсятся тем же `MOD_TAIL` parser-ом, что и для field/ln/package.ul.* (выносим `MOD_TAIL` и `parseModifiers()` в этот же helper). Неизвестный модификатор после `|` → `unknown_modifier` с человекочитаемым кодом и фразой; **никакого `\|[^}]+)?` permissive-кэтча**. Новый код-ошибки для pf-only невалидных модификаторов: `pf_unsupported_modifier` (мы согласовали этот код заранее).

### A3. Заменить 4 локальные классификации одной shared

- `StrictDocumentTemplatesManager.tsx`: удалить локальные `RX_PACKAGE_REQ / RX_PACKAGE_ROLE_LN / RX_LEGACY_*` и `parseStrictInside`. Использовать `evaluatePlaceholderInScope(inside, scope='unknown')` (standalone-шаблон не знает binding). Pf-токен здесь → `valid` синтаксически, но в текст диагностики добавить мягкое info-сообщение «токен `pf-` требует binding к пакету; активация standalone не разрешает использование в order-контексте».
- `canonical-template-apply-markup/index.ts` (edge): удалить локальные RX_*, импортировать mirror. Возвращаемая классификация ОБЯЗАТЕЛЬНО попадает в manifest через **новый коллектор `package_field_tokens[]**` (см. A4) — никакого «безусловного continue».
- `TemplateMarkupDialog.tsx` (`classifyTemplateToken`): тонкая обёртка над shared.
- `PackageTemplateValidationPanel.tsx`: убрать локальный `RX_PACKAGE_FIELD_PF`, использовать shared.

### A4. Edge сохраняет pf-токены в manifest

В `canonical-template-apply-markup` для каждого pf-токена пишем в `template_versions.manifest.tokens[]`:

```json
{ "kind": "package_field", "public_id": "pf-000003",
  "format": null, "case_modifier": null,
  "raw_inside": "pf-000003" }
```

Чтобы downstream (validation panel, snapshot, диагностика) видели токен. Этот же объект используется в `tokens_snapshot[]` при генерации.

### A5. Контекстный гейт активации (package vs standalone)

В `canonical-template-apply-markup` после классификации:

```text
if manifest.contains pf-* AND template_scope != 'package_bound':
    error 'package_token_outside_package_context'
```

Конкретно: шаблон, у которого нет ни одной связи в `document_package_items` и нет явного `meta.package_bound=true`, **не активируется** с pf-токенами. Это закрывает риск «активировать standalone-шаблон с pf и потом использовать его в order».

В `canonical-document-generate-strict` (генерация) при `scope='order'` обнаружение pf-токена → 400 `package_token_outside_package_context` (этот код там уже работает по факту, см. B4 предыдущей итерации; убедимся что классификатор всё ещё его триггерит).

### A6. Существующие коды ошибок (зафиксированы add-only, без удалений)


| code                                    | где триггерится                                           | новое/существующее |
| --------------------------------------- | --------------------------------------------------------- | ------------------ |
| `pf_token_not_found`                    | PackageTemplateValidationPanel (нет в catalog)            | существующее       |
| `pf_token_outside_bound_package`        | PackageTemplateValidationPanel (catalog у другого пакета) | существующее       |
| `pf_assignment_missing`                 | PackageTemplateValidationPanel                            | существующее       |
| `pf_unused_assignment`                  | PackageTemplateValidationPanel                            | существующее       |
| `pf_required_value_missing` (422)       | canonical-document-generate-strict                        | существующее B4    |
| `pf_unsupported_modifier`               | shared classifier                                         | **новое**          |
| `package_token_outside_package_context` | apply-markup + generate-strict                            | **новое**          |


---

## Часть B — Smart-date prefill: 11 новых kinds (4 month + 4 quarter + 3 year)

### B1. Полный список kinds (точно 11, не 12)

**Month (4):**

- `first_day_of_prev_month`, `last_day_of_prev_month`
- `first_day_of_next_month`, `last_day_of_next_month`

**Quarter (4):**

- `first_day_of_prev_quarter`, `last_day_of_prev_quarter`
- `first_day_of_next_quarter`, `last_day_of_next_quarter`

**Year (3) — для `data_type='year'`, возвращают 4-значное число строкой:**

- `prev_year`, `current_year`, `next_year`

«Текущий месяц / текущий квартал» НЕ добавляем — переиспользуем уже существующие `first_day_of_month`/`last_day_of_month`/`first_day_of_quarter`/`last_day_of_quarter`.

### B2. Безопасные date constructors (без `addMonths`)

В `src/lib/packageFields/smartDate.ts` строим даты через прямой конструктор:

```ts
const Y = today.getFullYear();
const M = today.getMonth();           // 0..11
// month anchors
const startPrevMonth = new Date(Y, M - 1, 1);
const endPrevMonth   = new Date(Y, M,     0);
const startNextMonth = new Date(Y, M + 1, 1);
const endNextMonth   = new Date(Y, M + 2, 0);
// quarter anchors
const Q = Math.floor(M / 3) * 3;      // 0|3|6|9
const startPrevQuarter = new Date(Y, Q - 3, 1);
const endPrevQuarter   = new Date(Y, Q,     0);
const startNextQuarter = new Date(Y, Q + 3, 1);
const endNextQuarter   = new Date(Y, Q + 6, 0);
// year
const prevYear = Y - 1, currYear = Y, nextYear = Y + 1;
```

Конструктор `new Date(Y, M, day)` автоматически нормализует переходы между годами (Q1→Q4 предыдущего, Q4→Q1 следующего, январь→декабрь, декабрь→январь). `addMonths` не используем.

### B3. Поведение для `datetime`

Для всех start-anchors время фиксируется `00:00:00.000`, для end-anchors — `23:59:59.999`. Timezone — `Europe/Minsk` (как у существующих `today`/`tomorrow`). Формат сериализации в session_field_value: ISO без сдвига зоны (то же, что сейчас).

Контракт «start = 00:00:00, end = 23:59:59.999, tz=Europe/Minsk» зеркалится в UI prefill, сохранённом значении и snapshot — одинаковая строка во всех трёх.

### B4. UI-фильтр kinds по data_type (жёсткий)

В `PackageFieldsManager.tsx` пересобрать список опций через хелпер:

```ts
function allowedKindsForType(t: PackageFieldDataType): SmartDateKind[] {
  if (t === 'year')                     return ['none','prev_year','current_year','next_year'];
  if (t === 'date' || t === 'datetime') return ['none', ...ALL_DATE_ANCHORS]; // без year-only
  return []; // для text/number/select/multiselect/checkbox/time — селект скрыт
}
```

Видимость селекта — `allowedKindsForType(dataType).length > 0`. Если пользователь меняет тип ДО сохранения (создание поля, тип ещё editable) и текущий `defaultKind` не входит в новый allowed-set → автоматически сбрасываем на `none`. Иначе `default_kind` в payload не пишется. После создания `data_type` immutable — поведение существующее.

### B5. Backend smart-date: проверка контракта перед утверждением «не трогаем»

Аудит уже сейчас (в плане, до build):

- `canonical-document-generate-strict` читает `default_kind` только для записи snapshot (`default_kind_applied`), без перевычисления;
- `ai-generate-document-package` тоже только читает строкой;
- `pf-required-gate.ts` обрабатывает `hidden_with_default`? — проверим строкой `grep hidden_with_default supabase/functions` в build-фазе; если да — расширим mirror в `supabase/functions/_shared/smart-date.ts` (создаём deno-зеркало `src/lib/packageFields/smartDate.ts` с теми же 11 новыми kinds), чтобы backend никогда не падал на unknown kind и не пересчитывал.
- Если `hidden_with_default` фактически не используется (или используется только для `today`/`tomorrow`/`generation_date`) — фиксируем это в proof, и тогда backend остаётся read-only по `default_kind_applied`. UI всегда сохраняет конкретное значение в `session_field_value` ДО генерации — это контракт «UI prefill».

**Гарантия:** ни один новый kind не считается на бекенде. Если test покажет иначе — расширяем deno-зеркало синхронно с UI.

### B6. Группировка опций в Select

Использовать `SelectGroup` + `SelectLabel` из shadcn (уже в проекте):

- «Сегодня / Завтра / Вчера»
- «Неделя» (Пн/Вс)
- «Месяц» (текущий + прошлый + будущий)
- «Квартал» (текущий + прошлый + будущий)
- «Год» (для year-type: 3 опции; для date/datetime: первый/последний день года)
- «Сессия» (`session_created_date`, `generation_date`)

---

## Часть C — Тесты (отдельные scope-ы, не объединять с pf-resolver)

### C1. Smart-date resolver

`src/lib/packageFields/smartDate.test.ts` — mock `Date` на фиксированные точки:

- `2026-06-16` (середина Q2) — все 11 kinds возвращают ожидаемые ISO.
- `2026-01-15` → `first_day_of_prev_month = 2025-12-01`, `first_day_of_prev_quarter = 2025-10-01`, `prev_year = "2025"`.
- `2026-12-20` → `last_day_of_next_month = 2027-01-31`, `first_day_of_next_quarter = 2027-01-01`, `next_year = "2027"`.
- `2024-02-29` (високосный) → `last_day_of_prev_month = 2024-01-31`, `last_day_of_next_month = 2024-03-31`.
- `2025-01-31` → `first_day_of_next_month = 2025-02-01` (никаких «31 февраля»).
- `datetime` сценарий: `first_day_of_next_month` → `2026-07-01T00:00:00.000` в Europe/Minsk; `last_day_of_next_month` → `…T23:59:59.999`.
- `next_year` при `2025-12-31` → `"2026"` (а не `"2025"`).

### C2. UI-фильтр options

`PackageFieldsManager.options.test.tsx`:

- `data_type='year'` → list = `['none','prev_year','current_year','next_year']`.
- `data_type='date'` → year-only kinds отсутствуют.
- Смена `year → date` сбрасывает `prev_year` в `none`.
- Смена `date → text` скрывает селект и очищает `default_kind`.

### C3. Snapshot строки `default_kind_applied`

Расширить `supabase/functions/canonical-document-generate-strict/*.test.ts` (или создать `tokens-snapshot.pf.test.ts`): убедиться что `default_kind_applied` сохраняется как переданная строка, в т.ч. для новых kinds (`prev_year`, `last_day_of_next_quarter`). Сам resolver НЕ вызывается на бекенде — снапшот пишет ровно то, что пришло.

### C4. Strict token classification для pf

`src/lib/documents/placeholderClassifier.test.ts`:

- `pf-000003` без модификаторов → `{kind: 'package_field', public_id, format:null, case:null}`.
- `pf-000003|format=text` → `format='text'`.
- `pf-000003|format=potato` → `unknown_modifier: 'format=potato'`.
- `pf-000003|hello=world` → `unknown_modifier: 'hello=world'` (НЕ valid).
- `pf-00003` (5 цифр) → `invalid`.
- В scope=`billing` любой pf → `package_token_outside_package_context`.

### C5. Edge mirror

`supabase/functions/_shared/placeholderClassifier.test.ts` — те же кейсы что в C4. Этим закрывается riск расхождения UI ↔ edge.

### C6. Existing tests

`pf-required-gate.test.ts`, `resolve-package-tokens.pf.test.ts`, `resolve-package-tokens.smoke.test.ts` — не трогаем по контракту, должны остаться 15/15 PASS.

---

## Часть D — Runtime UAT (включая standalone-защиту и закрытие deferred DOCX e2e)

### D1. Package-bound шаблон с pf активируется

`/admin/documents` → «Шаблоны документов» → «1. Приказ…» → «Проверка и исправление полей» → 0 ошибок → кнопка «Активировать шаблон» активна → активируем → `is_active=true`. Скрин.

### D2. Тот же токен в order/standalone-контексте — error

Создать тестовый standalone-шаблон с `{{pf-000003}}`, НЕ привязывать к пакету, попытаться активировать → ожидаем `package_token_outside_package_context` (новый код), активация заблокирована. Скрин + edge-log.

### D3. Order-генерация с pf → 400

Вызвать `canonical-document-generate-strict` в `scope='order'` с шаблоном, который содержит pf → 400 `package_token_outside_package_context`. curl-ответ + audit_logs.

### D4. UI smart-date: фильтрация по типу

«Пакеты документов» → «Поля пакета» → «Добавить поле» → тип «Год» → видим только year-kinds + none. Сменить тип на «Дата» → видим date-anchors + 4 month + 4 quarter + first/last day of year, БЕЗ `prev_year/current_year/next_year`. Скрин.

### D5. Year-shift в реальной анкете

Создать поле «Год отчёта» типа `year`, default = `next_year`, назначить шаблону. Открыть анкету сессии — поле автозаполнено `2027`. Сохранить. Снимок UI + строка в `document_package_session_field_values`.

### D6. Datetime с next_quarter

Создать поле типа `datetime`, default = `first_day_of_next_quarter`. Открыть анкету — увидеть автоподстановку `2026-07-01 00:00`. Сохранить.

### D7. DOCX e2e (раньше deferred — теперь обязателен, единым прогоном закрывает 5 пунктов)

Подготовить реальный `.docx` с `{{pf-000002}}` в шаблоне пакета. Пройти оба сценария на реальном endpoint `canonical-document-generate-strict`:

**Сценарий A (value present):**

- HTTP 200;
- `{{pf-000002}}` действительно заменён в итоговом DOCX (открыть, проверить визуально + через pandoc);
- `ai_generated_documents.meta.tokens_snapshot[]` содержит `{provider:'pf', public_id:'pf-000002', label, data_type, raw_value, rendered_value, default_kind_applied}`;
- audit_logs: `document_generated_strict`.

**Сценарий B (required value missing):**

- HTTP 422, body `{code:'pf_required_value_missing', ...}`;
- запись в `ai_generated_documents` НЕ создаётся;
- `tokens_snapshot[]` НЕ создаётся;
- audit_logs: `pf_required_value_missing` с reject reason.

### D8. Реальные audit_logs

Скопировать в proof реальные строки `audit_logs` для D1, D2, D3, D5, D7 (оба исхода).

---

## DoD (финальная сверка)


| #   | Проверка                                                                               | Доказательство                                         |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Shared `placeholderClassifier.ts` создан, 4 локальных regex удалены                    | diff + grep `RX_PACKAGE_` возвращает только новый файл |
| 2   | Deno mirror `_shared/placeholderClassifier.ts` 1:1 с фронтом                           | unit-тесты C4 ≡ C5                                     |
| 3   | `pf-XXXXXX` — `valid` синтаксис, `pf-XXXXXX                                            | unknown=x`—`pf_unsupported_modifier`                   |
| 4   | Edge сохраняет pf в `manifest.tokens[]` как `kind:'package_field'`                     | curl apply-markup + чтение row                         |
| 5   | `package_token_outside_package_context` блокирует активацию standalone-шаблона с pf    | D2                                                     |
| 6   | Order-генерация с pf → 400 `package_token_outside_package_context`                     | D3                                                     |
| 7   | 11 новых SmartDateKind (4+4+3), 0 дублей с существующими                               | typecheck + C1                                         |
| 8   | Date constructors без `addMonths`, проходят все граничные кейсы                        | C1                                                     |
| 9   | datetime: start=00:00, end=23:59:59.999, tz=Europe/Minsk одинаково в UI/value/snapshot | C1 + D6                                                |
| 10  | UI-фильтр жёсткий: year/date/datetime/прочее, сброс при смене типа                     | C2 + D4                                                |
| 11  | Backend никогда не вычисляет новые kinds; `hidden_with_default` контракт зафиксирован  | grep-аудит + C3                                        |
| 12  | 15 ранее существующих тестов всё ещё PASS                                              | test run                                               |
| 13  | DOCX e2e (A+B) выполнен на реальном шаблоне `{{pf-000002}}`                            | D7                                                     |
| 14  | Реальные audit_logs строки приложены                                                   | D8                                                     |


---

## Technical Notes

- Add-only к предыдущим B1–B5 артефактам. Никаких rename/удаления уже принятых файлов, кроме перевода 4 локальных классификаторов на shared (это и есть anti-divergence guarantee, без которой следующая итерация неизбежно разойдётся снова).
- Никаких миграций БД, enum, RPC. `options.default_kind` остаётся свободной строкой в JSONB.
- Никаких новых FLD, никаких изменений в `tariff_offers.meta.document_scenarios[]`, `ai_generated_documents` контракт сохраняется.
- Никакого `extract_document.py`/Gotenberg рефакторинга — изменяется только классификация и UI.