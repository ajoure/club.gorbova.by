# Да, согласен, с учетом правок:

```text
## Дополнения к плану

1. Add-only / no-loss правило

Ничего из текущего плана не удалять. Все новые пункты только дополняют его. Массовый UPDATE labels / tokens / aliases / archived_at выполнять только после dry-run summary и отдельного подтверждения.

---

## 2. Важная правка по smoke

Если smoke-шаблон использует token_key-плейсхолдеры вида:

- {{customer.address.full}}
- {{executor.address.full}}
- {{payer.name}}
- {{service.name}}
- {{order.number}}

то smoke нужно гонять через non-strict `canonical-document-generate`, который использует `_shared/document-render.ts`.

`canonical-document-generate-strict` использовать только для FLD-плейсхолдеров вида:

- {{field:FLD-000000}}

Поэтому в плане заменить пункт:

`прогнать canonical-document-generate-strict`

на:

`прогнать canonical-document-generate для token_key smoke; strict-smoke делать отдельно только для FLD-плейсхолдеров`.

---

## 3. Alias-механизм

Не добавлять новую колонку `alias_of UUID` в `document_token_registry`.

Использовать уже существующий механизм:

- `document_token_aliases`
- либо `document_token_registry.meta.alias_of`, только если это уже реально читается резолвером.

Перед execute обязательно проверить фактический alias-reader:

```bash
rg -n "document_token_aliases|alias_of|aliases" supabase/functions src
```

Если resolver уже читает `document_token_aliases`, использовать только его. Не плодить второй alias-механизм.

---

## **4. address.full resolver — проверить фактическое место**

Не писать абстрактно `_shared/document-token-resolver.ts`, пока не подтверждено, что именно он используется.

Перед правкой найти реальное место резолва:

```bash
rg -n "customer.address|executor.address|resolved_tokens|resolverValues|source_trace" supabase/functions/_shared supabase/functions
```

Если текущий token_key-render идёт через `_shared/document-render.ts`, то `address.full` и address-part tokens добавлять именно туда.

---

## **5. Поля address parts должны резолвиться, а не только появиться в registry**

Недостаточно добавить токены в `document_token_registry`.

Для каждого нового токена нужно проверить, что он реально подставляется:

### **Customer**

- `customer.address.street`
- `customer.address.house`
- `customer.address.building`
- `customer.address.apartment`
- `customer.address.city`
- `customer.address.district`
- `customer.address.city_district`
- `customer.address.region`
- `customer.address.postal_code`
- `customer.address.country`
- `customer.address.full`

### **Executor**

- `executor.address.street`
- `executor.address.house`
- `executor.address.building`
- `executor.address.apartment`
- `executor.address.city`
- `executor.address.district`
- `executor.address.city_district`
- `executor.address.region`
- `executor.address.postal_code`
- `executor.address.country`
- `executor.address.full`

DoD: smoke DOCX/PDF должен содержать не только полный адрес, но и отдельные части адреса.

---

## **6. Названия плейсхолдеров должны совпадать с UI-ячейками**

При нормализации labels сверять не только `fields_registry`, но и реальные формы:

- `/settings/legal-details` физлицо;
- `/settings/legal-details` организация / ИП;
- админские формы исполнителя;
- карточка сделки / документы.

Цель: пользователь видит в форме поле `Руководитель ФИО` и в каталоге плейсхолдеров видит такое же поле:

- `Заказчик: Руководитель ФИО`
- `Исполнитель: Руководитель ФИО`

Не оставлять labels типа:

- `Руководитель название`
- `legal signer`
- `director name`
- `address raw`
- `address street raw`
- `bank account raw`

---

## **7. Разделить labels и token_key**

Token key может оставаться техническим:

- `customer.director`
- `executor.bank_code`
- `customer.address.full`

Но `ui_label` / label в каталоге должен быть человеческим:

- `Заказчик: Руководитель ФИО`
- `Исполнитель: БИК / код банка`
- `Заказчик: Адрес полный`

Не переименовывать token_key без необходимости. Иначе можно сломать старые шаблоны.

---

## **8. Soft-delete шаблонов**

Правильно: добавить `deleted_at`.

Дополнить:

- все SELECT шаблонов должны фильтровать `deleted_at IS NULL`;
- edge generation должен hard-fail, если `deleted_at IS NOT NULL`;
- UI должен показывать warning, если сохранённый template_id указывает на deleted template;
- hard DELETE заменить на UPDATE `deleted_at=now()`;
- restore пока не делать, если не входит в scope.

DoD:

```sql
SELECT id, deleted_at FROM document_templates WHERE id = '<deleted_template_id>';
```

и proof, что этот шаблон:

- не виден в селекторах;
- не используется для генерации;
- старые документы не ломаются.

---

## **9. Whitelist городов без района**

Да, использовать минимум:

- Минск
- Брест
- Витебск
- Гомель
- Гродно
- Могилёв

Дополнительно добавить safeguard: если `city` заполнен и это город областного значения, не добавлять `district/region` в полный адрес. Если нет уверенности — не угадывать, оставить только явно безопасный whitelist.

---

## **10. Dry-run summary должен быть обязательным STOP**

Перед массовым execute обязательно прислать summary:

```text
Dry-run summary:
- labels rename: N
- missing tokens: N
- aliases: N
- duplicates to soft-deprecate: N
- example_value updates: N
- deleted_at migration needed: yes/no
- risky/conflicting fields: list
```

И только после подтверждения выполнять UPDATE / INSERT / archived_at.

---

## **11. Smoke должен быть финальным и единым**

После execute собрать один smoke DOCX/PDF, который проверяет:

- customer full address;
- customer address parts;
- executor full address;
- executor address parts;
- customer director fields;
- executor director fields;
- customer bank fields;
- executor bank fields;
- payer aliases;
- service aliases;
- order aliases;
- deleted template guard;
- old alias tokens.

DoD:

- `unresolved_count=0`;
- в PDF нет `{{...}}`;
- full address для Минска без лишнего района/области;
- alias tokens работают;
- deleted template не используется;
- `tsc` clean;
- `deno check` clean;
- audit_logs записаны.

---

## **12. Не смешивать с морфологией**

Морфология уже закрыта. В этом плане её не переделывать.

Разрешено только проверить, что новые labels и aliases не ломают уже существующий `|case=...`.

---

## **13. Финальный отчёт**

В финальном отчёте обязательно приложить:

1. Dry-run proof.
2. Таблицу `old_label → new_label`.
3. Список добавленных токенов.
4. Список aliases.
5. Список soft-deprecated duplicates.
6. Список example_value updates.
7. Proof по deleted templates.
8. Smoke DOCX/PDF proof.
9. `tsc` и `deno check`.
10. Подтверждение STOP-guards:

- `payments_v2` не трогали;
- `orders_v2 schema` не трогали;
- `allocate_document_number` не трогали;
- document scenarios не трогали;
- production-шаблоны не удаляли hard-delete.

```
Главное: пусть сначала делает **Discovery + dry-run**, а не сразу массовые правки.

План: полный аудит и нормализация плейсхолдеров реквизитов
```

## Diagnose (текущее состояние)

Перед массовыми правками собираем dry-run по `fields_registry` + `document_token_registry`:

- Сколько записей с category ∈ {customer, executor, legal_details}.
- Сверка `LEGAL_DETAILS_FIELD_MAP` (src/lib/legal-details/fieldMap.ts) с реальными колонками `client_legal_details` (leg_*, ent_*, ind_*).
- Сверка с UI-формой `RequisitesV2Manager` / редактором /settings/legal-details — какие поля реально заполняет пользователь.
- Поиск «технических» labels (`raw`, `legal signer`, `address street raw`, дублей `account`/`iban`/`bank_account`).
- Список существующих токенов customer.address.* / executor.address.* / customer.bank_* / executor.bank_*.
- Проверка наличия `deleted_at` в `document_templates`.

Вывод dry-run сохраняется в `.lovable/proofs/placeholders_normalization_dryrun_2026_05_13.md` со схемой:

| public_id | token_key | category | old_label | new_label | source | action |

action ∈ rename_label | add_missing_token | add_alias | soft_deprecate_duplicate | keep.

## Plan (что делаем)

### 1. Soft-delete шаблонов (миграция)

- ALTER TABLE `document_templates` ADD COLUMN `deleted_at TIMESTAMPTZ NULL`.
- Index `idx_document_templates_active_not_deleted` WHERE `deleted_at IS NULL AND is_active = true`.
- Edge: `canonical-document-generate-strict` уже проверяет `is_active` — добавить `deleted_at IS NULL`.
- Hook `useDocumentTemplates`: фильтр `deleted_at IS NULL` во всех list-запросах; mutation `deleteTemplate` → UPDATE deleted_at вместо DELETE; invalidate cache.
- UI селекторы шаблонов (DealPayerDocumentsCard, AdminProductsDocs, шаблонные Tabs): hide deleted; если `template_override` указывает на deleted → warning «Шаблон удалён, выберите другой» + блок генерации до выбора.

### 2. Нормализация labels в `fields_registry`

Каноническая схема: `{Сторона} {ФЛ|ЮЛ|ИП}: {суть поля}` для requisites-полей и `{Сторона}: {суть}` для customer/executor токенов верхнего уровня.

Преобразования (применяются по public_id, не по label):

- `customer.*`, `executor.*`: заменяем technical labels на «Заказчик: …» / «Исполнитель: …» по списку из ТЗ §3, §4.
- `legal_details.leg_*` → «Заказчик ЮЛ: …» / «Исполнитель ЮЛ: …» (определяется по category/scope).
- `legal_details.ent_*` → «… ИП: …».
- `legal_details.ind_*` → «… ФЛ: …».
- Адрес: street/house/building/apartment/city/district/city_district/region/postal_code/country — единый паттерн.
- Руководитель: position/name/short_name/acts_on_basis.
- Банк: bank_account (IBAN)/bank/bank_code (БИК).

### 3. Аудит и добавление недостающих токенов

Гарантировать наличие в `document_token_registry`:

**Customer (заказчик)** — full + parts:
`customer.address`, `customer.address.full`, `customer.address.street`, `.house`, `.building`, `.apartment`, `.city`, `.district`, `.city_district`, `.region`, `.postal_code`, `.country`.

**Executor** — зеркальный набор: `executor.address.full` + parts.

**Руководитель**: `customer.director_position`, `customer.director`, `customer.director_short`, `customer.acts_on_basis` + executor аналогично.

**Банк**: `customer.bank_account`, `customer.bank`, `customer.bank_code` + executor (`executor.account`, `executor.bank`, `executor.bank_code`).

Для отсутствующих — INSERT с привязкой к существующему `field_id` (через `LEGAL_DETAILS_FIELD_MAP`) + заполнение `ui_label`, `example_value`.

### 4. Aliases для старых токенов

Не удаляем `account`, `iban`, `bank_account` варианты — добавляем строку с `alias_of` (или meta.alias_of), помечаем `archived_at IS NULL` но `is_alias=true`. Token-resolver уже поддерживает чтение по token_key, alias просто маппится на тот же field_id.

### 5. Soft-deprecate дубликатов

Дубли (одно и то же поле под разными public_id) → ставим `archived_at = now()` + `meta.deprecated_reason='duplicate_of:<canonical>'`. В каталоге плейсхолдеров скрываем (PlaceholdersCatalogTab уже фильтрует `archived_at IS NULL`).

### 6. Полный адрес — резолвер

В `_shared/document-token-resolver.ts` (или эквивалент) добавить computed-резолвер для `*.address.full`:

- Сборка: `ул. {street}, д. {house}[, корп. {building}][, пом./кв. {apartment}], {city}, {postal_code}, {country||"Республика Беларусь"}`.
- Для Минска и областных центров (whitelist: Минск, Брест, Витебск, Гомель, Гродно, Могилёв) — НЕ добавлять `district`, `city_district`, `region`.
- Если `address` (raw) заполнен и parts пусты — fallback на raw.

### 7. Заполнение `example_value`

По всем customer/executor/legal_details токенам (~120 шт.) — заполнить `example_value` реалистичными BY-данными (ИП «Горбова Е.А.», УНП 192345678, «ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь»).

### 8. Audit logs

Записываем в `audit_logs` 4 события:

- `fields_registry.labels_normalized` (count, batch_id)
- `document_token_registry.tokens_added`
- `document_token_registry.aliases_added`
- `document_token_registry.duplicates_soft_deprecated`

batch_id = `PLACEHOLDERS-NORMALIZATION-2026-05-13`.

## Execute (порядок)

1. **Discovery query** → dry-run отчёт (proof file).
2. **STOP** → показать пользователю summary (counts), ждать «продолжай».
3. Миграция `document_templates.deleted_at` + индекс.
4. UPDATE `fields_registry.label` пакетами по category.
5. INSERT новых токенов в `document_token_registry`.
6. INSERT alias-строк.
7. UPDATE `archived_at` для дублей.
8. UPDATE `example_value` массово.
9. INSERT в `audit_logs` × 4.
10. Код: useDocumentTemplates, DealPayerDocumentsCard warning, edge soft-delete guard, address.full резолвер.
11. Smoke: создать тестовый шаблон со всеми токенами, прогнать `canonical-document-generate-strict`, убедиться `unresolved_count=0`.

## Verify (DoD)

- Dry-run отчёт сохранён.
- В каталоге `/admin/ai` плейсхолдеры показаны с понятными русскими labels (`Заказчик: …`, `Исполнитель: …`).
- Колонка «Пример» заполнена для customer/executor/legal_details токенов.
- Smoke DOCX→PDF: 0 unresolved tokens, адрес собирается без лишних district/region для Минска.
- Удалённый шаблон не виден в селекторах; если он был выбран — warning + блок генерации.
- Старые alias-токены резолвятся (обратная совместимость).
- `tsc --noEmit` clean (через build pipeline).
- Audit logs записаны.

## STOP-guards (не трогаем)

- `payments_v2`, `orders_v2` schema, `allocate_document_number`, document scenarios, Contact Center, морфология, hard-delete токенов/шаблонов, production-шаблоны.

## Файлы (предварительно)

- supabase/migrations/*: `document_templates.deleted_at`.
- supabase/functions/_shared/document-token-resolver.ts: `address.full` computed.
- supabase/functions/canonical-document-generate-strict/index.ts: `deleted_at IS NULL` guard.
- src/hooks/useDocumentTemplates.tsx: фильтр deleted, soft-delete mutation, invalidation.
- src/components/admin/DealPayerDocumentsCard.tsx: warning для deleted template.
- src/components/ai-documents/PlaceholdersCatalogTab.tsx: визуальные доработки (если нужно).
- src/utils/templateEditorTestData.ts: расширение.
- .lovable/proofs/placeholders_normalization_dryrun_2026_05_13.md (новый).
- .lovable/proofs/placeholders_normalization_execute_2026_05_13.md (после execute).
- .lovable/plan.md (обновить).

## Открытые вопросы (до execute)

1. **Whitelist «городов без района»**: предлагаю Минск + 5 областных центров. Расширить?
2. **Alias-механизм**: добавить колонку `alias_of UUID` в `document_token_registry` или хранить в `meta.alias_of`? Предлагаю `meta.alias_of` (миграция не нужна).
3. **Hard fail vs warning** на deleted template в edge function: предлагаю hard fail с error_code=`template_deleted`, UI ловит и показывает warning.

После approve — запускаю Discovery и присылаю dry-run summary перед массовыми UPDATE.