да, согласен, с учетом правок:

1. В п.4 нужно убрать противоречие: сейчас написано «миграция только `COMMENT ON COLUMN`-уровня», но одновременно планируется запись `document_template_versions.meta.requirements[]`. Если колонка `meta` уже существует — миграция не нужна, нужен только код записи/чтения. Если `meta` отсутствует — нужна миграция `ADD COLUMN meta jsonb default '{}'::jsonb`, а не `COMMENT`.
2. В п.12 SQL для `individual_requisites` нужно проверить фактическое имя поля владельца. Если в таблице используется не `owner_user_id`, а `user_id/profile_id/contact_id`, запрос заменить по фактической схеме. Не хардкодить `owner_user_id` до discovery.
3. В п.10 `get_my_requisites_status()` должен возвращать только сделки текущего пользователя и не раскрывать чужие сделки через join на orders/deals. Добавить отдельный DoD-proof на RLS/security: пользователь A не видит статус пользователя B.
4. В п.3 компонент `DealPayerDocumentsCard` должен быть встроен add-only в существующую карточку сделки/документов. Если уже есть `DealDocumentsCard`, сначала проверить, можно ли расширить его, а новый компонент создавать только если это не дублирует текущую логику.
5. В п.5 helper `selectCanonicalPayment(orderId)` должен быть read-only и не выполнять repair/reconcile. При нескольких successful платежах он выбирает последний, но в snapshot пишет `selection_reason: latest_successful_payment`.
6. В п.8 добавить в `ai_generated_documents.meta` минимальные technical IDs для поиска:
  - `order_id`
  - `deal_id`
  - `payment_id`
  - `payer_type`
  - `payer_type_source`
  - `scenario_id`
  При этом полный historical snapshot остается в `snapshot/source_trace/warnings_snapshot`.
7. В п.14 добавить DoD:
  - proof, что при Apple Pay / Google Pay без `card_holder`, `card_brand`, `card_last4` документ генерируется без ошибки;
  - proof, что `payment.description` не подставляет слово `null/undefined`;
  - proof, что `payment.*` пустые значения не создают warning уровня blocker.

Остальное можно запускать.

&nbsp;

План: Платежные сценарии документов, тип плательщика и requirements manifest

---

## 0. Результаты предварительного discovery (используем существующее)

- **Snapshot/history-слой уже существует** — таблица `ai_generated_documents` со столбцами `snapshot`, `source_trace`, `warnings_snapshot`, `token_manifest_snapshot`, `template_version_id`, `template_tokens_snapshot`, `idempotency_key`, `context_type/context_id`, `meta`. Дополнительно есть `generated_documents` (legacy/parallel) с `executor_snapshot`, `client_snapshot`, `order_snapshot`, `payer_type`. **Новый исторический слой не создаём.**
- **Текущие настройки кнопки документов уже живут** в `tariff_offers.meta.document_defaults` (`template_id`, `executor_id`, `generate_act`, `service_name`, `unit_price`, …). Вкладка «Документы» в редакторе кнопки уже реализована (см. скрин). **Расширяем существующую вкладку, не создаём заново.**
- `**payments_v2.status` enum по факту**: `succeeded | failed | refunded | processing | canceled`. Helper для «успешного» статуса централизовать (см. п.5).
- **Связь сделки↔платёж**: прямой FK `payments_v2.order_id → orders_v2.id`. Никаких fuzzy-связей по email/сумме.
- `**orders_v2.payer_type**` уже существует (сейчас всегда `individual`) — переиспользуем как итоговое значение, **дублировать в meta запрещено**.
- **Каталоги/реестры**: `document_token_registry`, `document_token_aliases`, `fields_registry`, `document_template_versions.token_manifest`. Перед созданием новой таблицы requirements обязан быть discovery-gate (см. п.4).

---

## 1. Канонические enum-ы и SOT

A. `payment_channel` (канал, derived, не хранится отдельной колонкой):
`card | apple_pay | google_pay | erip | bank_transfer | other`.
Маппинг — в одном месте: `_shared/document-resolver-v2/payment-channel.ts`, источник — `payments_v2.transaction_type`.

B. `payer_type` (тип плательщика): `individual | legal_entity`. SOT — `**orders_v2.payer_type**`. Не дублируется в meta.

C. `payer_type_source`: `auto | admin_override`. Хранится **только** в `orders_v2.meta.documents.payer_type_source` (см. п.7 — единое каноническое место для override).

**STOP**: запрещено выводить `payer_type` из `payment_channel`. Apple Pay / Google Pay / ЕРИП / bank_transfer могут принадлежать физлицу.

---

## 2. Сценарии документов на кнопке оплаты (расширение существующей вкладки)

Существующая вкладка «Документы» в редакторе кнопки сохраняется. Существующее поле «Шаблон акта + Исполнитель + Формировать акт» из `tariff_offers.meta.document_defaults` — это **fallback по умолчанию** и работает как раньше.

Расширение: новый блок «Сценарии документов по типу плательщика» внутри той же вкладки.

```jsonc
// tariff_offers.meta.document_scenarios
[
  {
    "id": "uuid",
    "payer_type": "individual",
    "payment_channels": ["card","apple_pay","google_pay","erip","bank_transfer"],
    "template_id": "uuid",
    "executor_id": "uuid",
    "requires_required_requisites": true
  }
]
```

Резолвер сценария:

1. матч `(payer_type, payment_channel)` в `meta.document_scenarios`;
2. fallback на сценарий того же `payer_type` без ограничения каналов;
3. fallback на `meta.document_defaults` (legacy) — backward-compat;
4. ничего нет → блокируем с понятным сообщением.

**Backward compatibility (правило)**:

> Если `document_scenarios` отсутствует, используются legacy-поля `meta.document_defaults` (`template_id`, `executor_id`, `generate_act`). Старые настройки не удаляем; новый блок — расширение, не замена.

---

## 3. Карточка сделки → блок «Документы / плательщик» (только document override)

Новый компонент `src/components/admin/DealPayerDocumentsCard.tsx` рядом с `DealDocumentsCard`.

Поля (только document-уровень, без вмешательства в платёж/order):

- **Тип плательщика**: показ auto + admin override (`individual | legal_entity`).
- **Способ оплаты**: read-only badge + tooltip с `transaction_type` (derived из `payments_v2`).
- **Шаблон документа**: auto из сценария, override.
- **Исполнитель**: auto из сценария, override.
- **Привязка реквизитов**: для `individual` → запись `individual_requisites`; для `legal_entity` → `legal_entities_requisites`. Можно выбрать конкретную карточку.
- **Статус реквизитов**: `complete | incomplete_required | incomplete_optional | missing` (источник — manifest, см. п.4).

**STOP-guard**:

> Admin override в карточке сделки изменяет только сценарий формирования документа. Он не модифицирует `payments_v2`, не переписывает фактический способ оплаты, не меняет данные провайдера и не пересчитывает order.

---

## 4. Requirements manifest (с discovery-gate)

**Сначала — discovery, без новой таблицы.** Проверяем, можно ли разместить requirements в уже существующих слоях:


| кандидат                                      | покрытие                                | вердикт                                                                                   |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `document_token_registry` + `fields_registry` | публичные FLD, label, тип               | подходит для метаданных поля, но не хранит «обязательность для конкретной версии шаблона» |
| `document_template_versions.token_manifest`   | список токенов, использованных в версии | подходит для `used=true`, но без `required/blocking/level/message`                        |
| metadata-поля версии шаблона                  | свободный JSONB                         | подходит, если расширить `meta.requirements[]`                                            |


Решение по итогу discovery:

- `used=true` хранится в существующем `token_manifest` — **новой таблицы не создаём**;
- `required/blocking/level/message/preset` — добавляются как раздел `document_template_versions.meta.requirements[]` (расширение существующего JSONB; миграция только `COMMENT ON COLUMN`-уровня, без новой таблицы).
- Если discovery покажет, что JSONB-расширение не выдерживает (нужны индексы / per-row queries), **только тогда** заводим `document_template_requirements` отдельной миграцией с явным обоснованием.

**Auto-сидинг (не блокирующий)**:

> Авто-сидинг создаёт draft requirements со статусом `suggested`. Поле, найденное в `token_manifest`, получает `used=true`. `required/blocking` выставляются по rule preset (тип документа: акт/счёт-акт/договор; категория поля) и могут быть изменены администратором. **Запрещено автоматически делать все used-поля `blocking=true`.**

Default rule preset (только предложение, не блокирующее):

- individual: `full_name` → suggested required+blocking; `address`, `passport_number_full` → suggested required только если used; `email/phone` → suggested optional.
- legal_entity: `full_name`, `unp`, `legal_address`, `signer.full_name`, `signer.acts_on_basis`, `org_form` → suggested required+blocking; `bank_account` — suggested required только если used.
- executor / payment — без auto-blocking.

Финальное `blocking` фиксирует админ во вкладке «Требования» редактора шаблона.

---

## 5. Селектор успешного платежа

Не хардкодим `status='succeeded'` россыпью. Создаём один helper:

```ts
// _shared/document-resolver-v2/payment-status.ts
export const SUCCEEDED_PAYMENT_STATUSES = ['succeeded'] as const; // discovery: enum {succeeded,failed,refunded,processing,canceled}
export function isSucceededStatus(s: string|null): boolean { ... }
export async function selectCanonicalPayment(orderId: string): Promise<PaymentRow|null> { ... }
```

Логика: последний `payments_v2` для `order_id` с `isSucceededStatus(status)`, сортировка `paid_at DESC NULLS LAST, created_at DESC`. Не фильтруем по `card_last4` (учим все каналы). Если уже есть канонический helper в проекте — используем его, локальный не создаём.

**Связь сделки и платежа**:

> Используется только прямая FK `payments_v2.order_id → orders_v2.id`. Если у сделки нет `payments_v2`-строки или она orphan/legacy — возвращаем warning «payment_not_found», генерация не падает, контекст `payment.*` пустой. Никакого fuzzy matching по email/сумме.

---

## 6. Группа плейсхолдеров «Платежи»

Категория `payment` в `document_token_registry`. 12 универсальных токенов (для каждого — `fields_registry`-запись с FLD-XXXXXX):


| token_key                         | UI-метка                   | Источник                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment.method`                  | Способ оплаты (код)        | `payment_channel`                                                                                                                                                                                                                                             |
| `payment.method_label`            | Способ оплаты              | «Карта» / «Apple Pay» / «Google Pay» / «ЕРИП» / «Банковский перевод» / «Иное»                                                                                                                                                                                 |
| `payment.description`             | **Описание платежа**       | составное; для card: `Mastercard **** 1234, IVANOV IVAN`; для erip: `ЕРИП, операция {provider_payment_id}`; для bank_transfer: `Банковский перевод, № {provider_payment_id}`; для apple_pay/google_pay: `Apple Pay` / `Google Pay` (+ `**** last4` если есть) |
| `payment.card.brand`              | Бренд карты                | `card_brand`, может быть пуст для Apple/Google Pay                                                                                                                                                                                                            |
| `payment.card.brand_normalized`   | Бренд (нормализованный)    | `normalizeBrand(card_brand)`                                                                                                                                                                                                                                  |
| `payment.card.last4`              | Последние 4 цифры карты    | `card_last4`, может быть пуст                                                                                                                                                                                                                                 |
| `payment.card.holder`             | Держатель карты            | `card_holder`, **может быть пуст для Apple/Google Pay — это не ошибка**                                                                                                                                                                                       |
| `payment.paid_at`                 | Дата оплаты                | `paid_at`                                                                                                                                                                                                                                                     |
| `payment.amount`                  | Сумма платежа              | `amount`                                                                                                                                                                                                                                                      |
| `payment.currency`                | Валюта платежа             | `currency`                                                                                                                                                                                                                                                    |
| `payment.provider_transaction_id` | ID транзакции у провайдера | `provider_payment_id`                                                                                                                                                                                                                                         |
| `payment.external_reference`      | Внешняя ссылка/ref         | `meta.external_reference`                                                                                                                                                                                                                                     |


UI-label сменён с «Реквизиты платежа» на **«Описание платежа»**, чтобы не путать с реквизитами клиента.

**STOP-guard**:

> `payment.*` — техническое описание платежа, **не** юридические реквизиты плательщика. Реквизиты плательщика живут в `individual.*`, `legal_entity.*`, `executor.*`. Запрещено писать `card_holder` / `card_last4` в `individual_requisites`.

Любые отсутствующие значения → **пустая строка**, не ошибка.

UI: `PlaceholdersCatalogTab.tsx` — добавить `payment: 'Платежи'` в `GROUP_LABELS`. Никакого нового token-picker.

---

## 7. Каноническое место admin override

Единое место (других нет):

```jsonc
// orders_v2.meta.documents
{
  "payer_type_source": "auto" | "admin_override",
  "payer_entity_override": { "kind": "individual"|"legal_entity", "id": "uuid" } | null,
  "template_override": "uuid" | null,
  "executor_override": "uuid" | null,
  "current_status": {
    "requisites_status": "complete|incomplete_required|incomplete_optional|missing",
    "checked_at": "iso",
    "last_blocking_reason": "string|null"
  }
}
```

`orders_v2.payer_type` остаётся SOT-колонкой; **новых колонок не добавляем**. Значение `payer_type` пишется напрямую в колонку, в `meta` дублирования нет.

`orders_v2.meta.documents` хранит **только operational overrides и текущий статус**. Полный snapshot факта генерации — в `ai_generated_documents` (см. п.8).

---

## 8. Snapshot факта генерации — в существующий слой

Используем `ai_generated_documents` (он уже хранит `snapshot`, `source_trace`, `warnings_snapshot`, `template_version_id`, `template_tokens_snapshot`, `meta`). Расширяем формат `snapshot` без миграции схемы:

```jsonc
snapshot: {
  fields: { "FLD-...": { ... } },
  payment: PaymentContext,
  payer: PayerContext,
  scenario: DocumentScenarioContext,
  requirements_check: {
    template_version_id, status,
    required_fields_checked: [], missing_required_fields: [], missing_optional_fields: []
  }
}
warnings_snapshot: [{ level: 'info', field, message }]
source_trace: [
  'payments_v2','orders_v2','tariff_offers.meta.document_scenarios|document_defaults',
  'document_templates','document_template_versions',
  'individual_requisites|legal_entities_requisites','executors'
]
```

**Правило**:

> `orders_v2.meta.documents` хранит только operational overrides/current status. Исторический snapshot генерации хранится в существующем `ai_generated_documents` (snapshot/source_trace/warnings_snapshot). Новый history-слой не создаётся.

`generated_documents` (legacy parallel layer) не трогаем.

---

## 9. Алгоритм генерации (без новых параллельных генераторов)

Расширяем существующий `document-field-resolver-v2-snapshot` + `canonical-document-generate*`:

1. Загрузить `order` (`orders_v2`).
2. `selectCanonicalPayment(order.id)` → payment + `payment_channel`.
3. Определить `payer_type`: `meta.documents.payer_type_source='admin_override'` → `orders_v2.payer_type` как override; иначе сценарий → его `payer_type`; иначе fallback `individual`.
4. Найти scenario из `meta.document_scenarios` по `(payer_type, payment_channel)`; иначе fallback на `meta.document_defaults`.
5. `template_id`: `meta.documents.template_override` ∥ `scenario.template_id` ∥ `document_defaults.template_id`. Нет → блок.
6. `executor_id`: аналогично.
7. Загрузить реквизиты по `payer_entity_override` ∥ default карточке `owner_user_id`.
8. По `template_version.meta.requirements` сравнить с реальными значениями → `missing_required_fields[]`, `missing_optional_fields[]`, `requisites_status`.
9. Если `requires_required_requisites=true` И `missing_required_fields.length>0` → блок с понятным сообщением и списком.
10. Только optional missing → генерация идёт, в `warnings_snapshot` пишется `info`-warning.
11. Резолвер v2 → snapshot → запись в `ai_generated_documents`. `orders_v2.meta.documents.current_status` обновляется.

Юрлицо: если `payer_type='legal_entity'` и нет шаблона юрлица → блок «Не выбран шаблон для юрлица», но статус и причина показываются. UI override-а позволяет выбрать карточку юрлица из `legal_entities_requisites` и видеть `missing_required_fields`.

---

## 10. RPC и личный кабинет

Два RPC, никакого `user_id` с клиента:

- `get_my_requisites_status()` — `auth.uid()`-only, RLS: `authenticated`. Возвращает по каждой оплаченной сделке статус реквизитов.
- `get_deal_requisites_status(deal_id uuid)` — RBAC `admin|super_admin` через `has_role_v2`. Для админки.

UserRequisites (`src/pages/settings/UserRequisites.tsx`):

- `incomplete_required` / `missing` → блокирующая карточка «Заполните обязательные реквизиты», CTA → скролл к нужному блоку.
- только `incomplete_optional` → мягкая non-blocking подсказка.
Обязательность поля приходит из `requirements` (manifest), не хардкодится в UI.

---

## 11. Audit logs (server-side, JWT-actor)


| action                                         | when                             |
| ---------------------------------------------- | -------------------------------- |
| `deal.payer_type.override`                     | админ сменил тип плательщика     |
| `deal.document_template.override`              | админ сменил шаблон              |
| `deal.executor.override`                       | админ сменил исполнителя         |
| `deal.payer_entity.override`                   | админ сменил карточку реквизитов |
| `document.generation_blocked.required_missing` | блок при отсутствии обязательных |
| `document.generated.with_optional_warnings`    | сгенерирован с info-warnings     |


`actor_type='user'`, `actor_user_id` из JWT (не из body), `actor_label`= email/имя.

---

## 12. Discovery dry-run (до старта реализации)

Запросы read-only, без миграций:

```sql
-- offer/button с document settings
select count(*) from tariff_offers where (meta->'document_defaults') is not null;

-- offer/button без executor / template
select count(*) from tariff_offers where coalesce(meta#>>'{document_defaults,executor_id}','')='';
select count(*) from tariff_offers where coalesce(meta#>>'{document_defaults,template_id}','')='';

-- paid orders с payments_v2
select count(distinct o.id) from orders_v2 o join payments_v2 p on p.order_id=o.id where p.status='succeeded';

-- распределение payment channels по transaction_type
select transaction_type, count(*) from payments_v2 where status='succeeded' group by 1 order by 2 desc;

-- сделки без individual_requisites владельца
select count(*) from orders_v2 o
  left join individual_requisites ir on ir.owner_user_id = o.user_id and ir.is_default
  where o.payer_type='individual' and ir.id is null;
```

Результат фиксируется в discovery-отчёте перед началом spринта.

---

## 13. STOP-guards (фиксируем в коде и memory)

- `payer_type` нельзя выводить из `payment_channel`. Apple Pay / Google Pay / ЕРИП / bank_transfer ≠ автоматически юрлицо.
- Admin override в карточке сделки **не модифицирует** `payments_v2` и фактический способ оплаты.
- Optional реквизиты не блокируют генерацию.
- `payment.*` ≠ реквизиты плательщика (`individual.*`/`legal_entity.*`/`executor.*`).
- Новых таблиц/генераторов/picker-ов/локальных списков токенов не создаём.
- Хардкод `status='succeeded'` россыпью запрещён — только helper.
- `user_id` с клиента в RPC не передаётся.
- Auto-сидинг requirements не делает used-поля автоматически `blocking=true`.
- `card_holder/card_last4` не пишутся в `individual_requisites`.
- Авто-смена `individual → legal_entity` без admin override запрещена.
- Старые `meta.document_defaults` не удаляются.
- `ai_generated_documents` остаётся единственным history-слоем; новый не создаётся.
- Вкладка «Документы» в редакторе кнопки уже существует — расширяем, не пересоздаём.

Memory к созданию:

- `mem://architecture/documents/payer-vs-payment-channel-sot`
- `mem://architecture/documents/document-snapshot-history-layer` (фиксирует `ai_generated_documents` как SOT истории).

---

## 14. Definition of Done

1. `payment_channel` derived в одном helper-е; `payer_type` — отдельная сущность; разделение зафиксировано в коде и memory.
2. Card / Apple Pay / Google Pay / ЕРИП / bank_transfer ведут к `payer_type=individual` через сценарий, без обратного хардкода.
3. В карточке сделки админ меняет `payer_type`, `template`, `executor`, `payer_entity` — только document-override, без модификации `payments_v2`.
4. Все ручные изменения → `audit_logs` с JWT-actor.
5. На кнопке оплаты во вкладке «Документы» доступен блок «Сценарии документов по типу плательщика»; для физлица настроен сценарий.
6. Юрлицо поддержано на уровне override / status / requirements / blocking; без шаблона юрлица — блок с понятной причиной.
7. Карточка сделки показывает `requisites_status` и причину блокировки/предупреждения.
8. Генерация блокируется только при `missing_required && requires_required_requisites=true`.
9. Optional missing → non-blocking warning.
10. Личный кабинет уведомляет о незаполненных обязательных реквизитах с CTA; для optional — мягко.
11. Snapshot пишется в `ai_generated_documents` (`snapshot`, `source_trace`, `warnings_snapshot`); `orders_v2.meta.documents` содержит только operational overrides + current_status.
12. Группа «Платежи» с 12 FLD-плейсхолдерами доступна в каталоге; пустые значения не ломают генерацию (включая отсутствие `card_holder/brand` для Apple/Google Pay).
13. Ни одного нового параллельного generator / picker / локального списка токенов.
14. Memory обновлён: `payer-vs-payment-channel-sot`, `document-snapshot-history-layer`; ссылка добавлена в `mem://index.md`.
15. **Proof**: существующие кнопки со старой настройкой акта (`meta.document_defaults`) продолжают генерировать без изменений.
16. **Proof**: при отсутствии `meta.document_scenarios` срабатывает backward-compat fallback на `document_defaults`.
17. **Proof**: admin override в карточке сделки не изменяет `payments_v2` (diff до/после override).
18. **Proof**: `get_my_requisites_status()` использует `auth.uid()`, клиент не передаёт `user_id` (PG-функция + RLS-проверка).
19. **Proof**: snapshot пишется в `ai_generated_documents`, в `orders_v2.meta.documents` — только operational status/overrides (схема + пример записи).
20. **Proof**: used token ≠ автоматически `blocking=true` required field (юнит-тест на auto-сидинг + ручной override).
21. Финальный отчёт на русском со списком изменённых файлов, миграций, тестов и DoD-пруфов.

---

## 15. Что НЕ делаем в этом спринте

- Полноценную генерацию для юрлица (только override / status / requirements / blocking).
- Новые каналы оплаты сверх перечисленного enum.
- Изменение `tariff_offers.payment_method` (это billing-модель).
- Замену UI каталога плейсхолдеров — расширяем существующий.
- Новый history-слой документов — используем `ai_generated_documents`.
- Создание `document_template_requirements` — только если discovery (п.4) докажет, что JSONB в `document_template_versions.meta.requirements[]` недостаточен.
- Reconcile orphan-платежей — отдельный план, не здесь.