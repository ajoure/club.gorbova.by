## да, согласен, с учетом правок:

1. **Главная логика теперь правильная**

План наконец фиксирует нужную модель:

```text
Одна база реквизитов:
client_legal_details
legal_details_persons

Два разных контекста:
billing → orders_v2/customer/executor
package → document_package_sessions/session_participants
```

Это то, что нужно. Новые таблицы реквизитов не создаются, биллинговые данные не копируются, `orders_v2` как источник для пакета не используется.

---

## **Обязательные правки перед approve**





### **1. Не использовать термин**

`reuse_existing_fld` **без уточнения**

В §2.3 и §3 написано `reuse_existing_fld`. Это может быть опасно: Lovable может понять, что можно напрямую использовать старый billing FLD как готовый package token.

Нужно заменить на:

```text
reuse_existing_field_definition
```

И отдельно прописать:

```md
Reuse означает переиспользование структуры поля, label, типа данных, форматирования и source-column mapping.

Reuse НЕ означает использование billing resolver/source path.

Billing source path:
orders_v2 / customer / executor

Package source path:
document_package_sessions / document_package_session_participants
```

---

### **2. Пакетные UL/IP/FL должны иметь отдельный package-token, даже если используют тот же source definition**

Для Word-шаблона пакета нельзя просто вставить старый:

```text
{{field:FLD-000342}}
```

если этот FLD сейчас означает «Заказчик ЮЛ: Название» в billing context.

Нужно явно решить, какой будет копируемый токен в Word для package context.

В план добавить:

```md
В Sprint 3D нужно определить copy-token формат для package placeholders.

Нельзя автоматически использовать billing token `{{field:FLD-...}}`, если он резолвится через billing context.

Для package context нужен один из вариантов:
A. `{{field:FLD-XXXXXX|context=package}}`
B. `{{package.ul.FLD-XXXXXX}}`
C. alias-token, который ссылается на existing field definition, но резолвится через package_session.

До выбора синтаксиса нельзя считать package placeholders рабочими.
```

Иначе ты скопируешь плейсхолдер из группы «Пакет: ЮЛ», вставишь в Word, а генератор подставит не компанию пакета, а биллингового заказчика.

---

### **3. Не показывать в UI пакетные поля как рабочие, пока не выбран синтаксис**

В §3 написано: отображаем поля со статусом `available`.

Нужно уточнить:

```md
`available` означает: есть source field и source column.

Но для копирования в Word поле становится `copy_ready` только после утверждения package-token syntax.

Статусы:
- `source_available`
- `copy_ready`
- `pending_field`
- `missing_source_column`
- `deferred`
```

---

### **4. Группы лучше назвать по-русски + аббревиатура**

Чтобы не было UI на английском:

```text
Пакет: ЮЛ
Пакет: ИП
Пакет: ФЛ
```

А не только `UL / IP / FL`.

Можно в скобках:

```text
Пакет: ЮЛ (UL)
Пакет: ИП (IP)
Пакет: ФЛ (FL)
```

Но основное название — русское.

---





### **5. Для ФЛ нельзя зеркалить 26 полей, если**

`legal_details_persons` **реально не содержит эти поля**

План это уже частично учитывает, но нужно жёстче:

```md
Группа «Пакет: ФЛ» зеркалит «Заказчик ФЛ» только по целевой структуре.

Фактически в UI как copy-ready выводятся только поля, у которых:
1. есть колонка в `legal_details_persons`;
2. есть FLD или утвержденный alias;
3. есть package resolver path.

Остальные поля попадают в manifest gaps и не выдаются как рабочие плейсхолдеры.
```

---



### **6. Не трогать**

`Исполнитель ЮЛ`

В плане есть inventory `Исполнитель ЮЛ`, но для пакетных документов сейчас не нужно зеркалить исполнителя.

Добавить:

```md
`Исполнитель ЮЛ` используется только как reference для понимания структуры реквизитов, но в Sprint 3D не создается группа «Пакет: Исполнитель ЮЛ».

Для пакетов используем только:
- Пакет: ЮЛ;
- Пакет: ИП;
- Пакет: ФЛ.
```

---

### **7. Привязка шаблона к пакету — только если безопасны права**

В §9 указано, что UI пакета создаёт `document_package_template_items`.

Добавить guard:

```md
Перед добавлением UI-привязки проверить RLS/permissions.

Если прямой INSERT из frontend небезопасен, не делать прямой INSERT.
Сделать admin-only RPC/edge action с audit_logs.
Обычный пользователь не должен иметь права привязывать шаблоны к пакету.
```

---

### **8. Smoke на биллинговом акте не должен запускать генерацию, если это запрещено**

В DoD написано:

```text
manual smoke на одном существующем акте — успех
```

Но hard constraints запрещают генерацию.

Заменить на:

```md
Billing regression smoke без генерации:
- существующие группы в UI не изменились;
- список FLD до/после идентичен;
- существующий шаблон акта открывается;
- его плейсхолдеры отображаются как раньше;
- генерацию не запускать.
```

---

## **Готовый короткий ответ Lovable**

```md
да, согласен, с учетом правок:

1. Везде заменить `reuse_existing_fld` на `reuse_existing_field_definition`. Reuse означает переиспользование label/type/source-column mapping, но не billing resolver/source path.

2. До реализации обязательно выбрать copy-token syntax для package context. Нельзя автоматически использовать `{{field:FLD-...}}`, если этот токен резолвится через billing context. Для package должен быть отдельный package-aware token format или alias/wrapper.

3. Ввести статусы: `source_available`, `copy_ready`, `pending_field`, `missing_source_column`, `deferred`. В UI как копируемые показывать только `copy_ready`.

4. Группы в UI называть по-русски: `Пакет: ЮЛ`, `Пакет: ИП`, `Пакет: ФЛ`. Аббревиатуры UL/IP/FL можно показывать только дополнительно.

5. `Пакет: ФЛ` зеркалит «Заказчик ФЛ» как целевую структуру, но рабочими показываются только поля, где есть колонка `legal_details_persons`, FLD/alias и package resolver path. Остальное — manifest gaps, не copy-ready.

6. `Исполнитель ЮЛ` использовать только как reference. Не создавать группу «Пакет: Исполнитель ЮЛ».

7. Перед UI-привязкой шаблона к пакету проверить RLS/permissions на `document_package_template_items`. Если прямой INSERT небезопасен — сделать admin-only RPC/edge action с audit_logs.

8. Billing smoke делать без генерации: только проверка, что существующие группы/FLD/шаблоны актов не изменились. Генерацию не запускать.

9. `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing/customer/executor resolver не трогать.
```

## **Итог**

План можно утверждать **только после этих правок**.

Самая важная правка: **нельзя просто копировать старый** `{{field:FLD-...}}` **в пакетный Word-шаблон, если он будет резолвиться как биллинговый заказчик.** Нужно отдельное package-aware представление того же поля.

&nbsp;

Sprint 3D (обновлённый) — Пакетные плейсхолдеры UL / IP / FL поверх существующей базы реквизитов

### 0. Главная архитектурная фиксация

- Базы реквизитов уже есть: `client_legal_details` (юрлицо + ИП), `legal_details_persons` (физлица), `legal_details_entity_person_links`.
- Биллинговый контекст: `orders_v2 / payer_type / customer / executor` → существующие группы «Заказчик ЮЛ / ИП / ФЛ», «Исполнитель ЮЛ». **Не трогаем.**
- Пакетный контекст: `document_package_sessions.selected_legal_entity_id → client_legal_details` и `document_package_session_participants.person_id → legal_details_persons` (+ `role_key` + `metadata.position`).
- **Одна база реквизитов + два разных контекста выбора + отдельный package resolver.**
- НЕ создаём новые таблицы реквизитов, НЕ копируем биллинговые данные, НЕ берём `orders_v2/customer/executor` как источник для пакета.

### 1. Жёсткие ограничения (без изменений)

- НЕ трогать `canonical-document-generate-strict`.
- НЕ запускать генерацию, Gotenberg, `ai_generated_documents`.
- НЕ менять биллинговые группы (Заказчик ЮЛ/ИП/ФЛ, Исполнитель ЮЛ) и их FLD.
- НЕ создавать namespace `documents:package:ideology`.
- НЕ создавать `package.roles.ideology_responsible.*`.
- НЕ создавать роль-specific группы плейсхолдеров («Ответственное лицо», «Составитель», «Контролирующее лицо», «Компания пакета», «Участники пакета»).
- НЕ создавать новые FLD без manifest-proof.
- НЕ делать synthetic dry-run.
- Все UI-labels на русском; технические ключи — только в debug-колонке для super_admin.

### 2. Discovery (read-only, делается первым)

#### 2.1. Inventory существующих биллинговых групп

```sql
SELECT public_id, key, label, entity_type, data_type
FROM fields_registry
WHERE archived_at IS NULL
ORDER BY entity_type, public_id;
```

Зафиксировать в proof фактический состав:

- Заказчик ФЛ (ожидаем ~26 полей);
- Заказчик ЮЛ (ожидаем ~24);
- Заказчик ИП (ожидаем ~24);
- Исполнитель ЮЛ (ожидаем ~23);
- Универсальные поля.

#### 2.2. Inventory колонок-источников

Уже снято в discovery, фиксируется в proof:

- `client_legal_details`: префиксы `leg_*` (юрлицо: org_form, name, unp, address, director_position, director_name, acts_on_basis, address_structured, grp_short_name…), `ent_*` (ИП: ent_name, ent_unp, ent_address, ent_acts_on_basis, ent_address_structured), `ind_*` (физлицо как клиент), общие: `bank_account, bank_name, bank_code, phone, email`.
- `legal_details_persons`: `full_name, birth_date, personal_number, passport_series, passport_number, passport_issued_by, passport_issued_date, passport_valid_until, …`.
- `document_package_sessions`: `selected_legal_entity_id, package_template_id, status, legal_entity_locked_at, metadata`.
- `document_package_session_participants`: `legal_entity_id, person_id, role_key, role_catalog_id, is_primary, metadata` (включая `metadata.position`).

#### 2.3. Сопоставительная таблица (mapping manifest)

Для **каждого** поля биллинговой группы заполнить:


| package_group | package_label (RU) | billing_analog_public_id | billing_analog_label | source_table | source_column | needs_new_fld? | decision |
| ------------- | ------------------ | ------------------------ | -------------------- | ------------ | ------------- | -------------- | -------- |


Для каждой строки одно из решений:

- `reuse_existing_fld` — FLD уже есть, package-контекст просто переиспользует через package resolver;
- `needs_new_fld` — поля нет в `fields_registry`, но колонка-источник есть → добавить FLD в Sprint 3E (не сейчас);
- `missing_source_column` — нет ни FLD, ни колонки → defer + явный backlog item;
- `package_specific` (только для `metadata.position` физлица в роли);
- `defer` — пока не нужно.

### 3. Целевой состав групп

В UI разделе «Документы → Плейсхолдеры» добавить три новые группы (после существующих):

- **Пакет: ЮЛ** — зеркало «Заказчик ЮЛ» (~24 поля), источник `package_session.selected_legal_entity_id → client_legal_details (leg_*)`.
- **Пакет: ИП** — зеркало «Заказчик ИП» (~24 поля), источник `package_session.selected_legal_entity_id → client_legal_details (ent_* + общие)`.
- **Пакет: ФЛ** — зеркало «Заказчик ФЛ» (~26 полей), источник `package_session_participants.person_id → legal_details_persons`.

⚠️ В Sprint 3D **отображаем только те поля, для которых уже есть FLD и колонка-источник** (decision `reuse_existing_fld`). Поля с `needs_new_fld` / `missing_source_column` идут в manifest как explicit gaps и в backlog Sprint 3E, **в UI не показываются** (или показываются как `disabled` с пометкой «появится позже»). Никаких слепых INSERT в `fields_registry`.

### 4. Роли в пакете (НЕ группы плейсхолдеров)

- Роль (`company_head`, `ideology_responsible`/`responsible_person`, `document_preparer`, `control_person` и др. из `document_package_role_catalog`) определяет, **какое физлицо** подставить в FL-плейсхолдер.
- Выбор «человек → роль» происходит в анкете пакета (`document_package_session_participants`), а НЕ в каталоге плейсхолдеров.
- Должность в конкретном пакете хранится в `document_package_session_participants.metadata.position` (это уже сделано в Sprint 3C).

### 5. Решение по синтаксису роль-привязки FL-плейсхолдера (Discovery + выбор)

Зафиксировать решение в proof после проверки текущего renderer.

Кандидаты:

- **A. Role modifier:** `{{field:FLD-XXXXX|role=company_head}}` — один FLD, роль как modifier. Требует проверки support modifiers в renderer.
- **B. Alias wrapper:** `{{package.role.company_head.FLD-XXXXX}}` — alias-резолвер поверх FLD (реюзает `document_package_token_aliases`).
- **C. UI-only label:** в picker'е показываем строки «ФЛ: ФИО — руководитель организации», но внутри они НЕ создают новых FLD, а сериализуются в выбранный синтаксис (A или B).

Решение принимается в discovery; до него — **не плодим новые FLD/aliases**. Уже существующие alias'ы из Sprint 3B (`package.roles.company_head.full_name/position`, `package.roles.responsible_person.full_name/position` поверх FLD-000372/000373) остаются как есть и переоцениваются в proof: либо реюзаем для FL: ФИО/должность, либо deprecate в пользу выбранного варианта.

### 6. FLD-000372 / FLD-000373 — что с ними делать

- Это базовые canonical FLD на `legal_details_persons.full_name` и `.position`. Оставляем.
- Manifest должен явно ответить: достаточно ли существующих FLD физлица (372/373 + всё, что уже есть) для покрытия «Заказчик ФЛ» 26-полевого зеркала. Если нет — список недостающих FLD идёт в Sprint 3E backlog, **без создания сейчас**.

### 7. UI-слой (что меняем)

- В компонент `PlaceholdersCatalogTab` (или соответствующий «Документы → Плейсхолдеры») добавить три новые группы поверх существующего рендера:
  - читаем package-каталог из нового статического файла `src/utils/packagePlaceholderCatalog.ts` (frontend-only, без записи в БД);
  - каждый элемент = `{ groupId, label_ru, source_table, source_path, billing_fld_analog, package_token, package_resolver_hint, status: 'available'|'pending_field' }`;
  - в UI — русский label, копируемый плейсхолдер (формат из §5), тип данных, доступные модификаторы (если они есть в текущем renderer), пример, копи-кнопка — как у биллинговых строк.
- Debug-колонка с техническими ключами (`source_table.column`, alias-token) видна только при `useSuperAdmin() === true`.
- Search-фильтр picker'а ищет и по русским labels package-каталога.
- Никаких изменений в способе авторства Word: админ копирует плейсхолдер → вставляет в Word → загружает шаблон → привязывает к пакету. Кнопка привязки шаблона к пакету «Идеология» (создание строки в `document_package_template_items`) остаётся как было запланировано в исходном Sprint 3D (без генерации).

### 8. Backend / resolver

- `_shared/resolve-package-tokens.ts` остаётся с `HARDCODED_ENABLED=false`, 0 production-импортов.
- Никаких изменений в `canonical-document-generate-strict`.
- Никаких новых edge functions (`package-template-dry-run` отложен до Sprint 3E).
- Подготовка package-resolver контракта (только документация в proof): описать, как при будущем рендере для каждого UL/IP/FL токена будет резолвиться источник:
  - UL/IP → `client_legal_details WHERE id = session.selected_legal_entity_id`;
  - FL → `legal_details_persons WHERE id = (SELECT person_id FROM session_participants WHERE session_id=? AND role_key=?)`;
  - `metadata.position` → `session_participants.metadata->>'position'` по той же выборке.

### 9. Файлы

**Создаются:**

- `src/utils/packagePlaceholderCatalog.ts` — статический каталог UL/IP/FL групп с маппингом на существующие FLD + флагом `status`.
- `src/utils/packagePlaceholderCatalog.test.ts` — проверки: (a) каждый item ссылается на реально существующий FLD `public_id` из snapshot или помечен `pending_field`; (b) состав UL/IP/FL зеркалит соответствующие биллинговые группы по количеству и labels; (c) нет токенов `package.roles.ideology_responsible.*`.
- `.lovable/proofs/package_documents_sprint3d_ul_ip_fl_placeholders_2026_05.md` — содержит секции 1–12 из ТЗ пользователя.

**Изменяются:**

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (+ три package-группы, debug-колонка).
- `src/components/ai-documents/FieldPickerPopover.tsx` (optional extraGroups — если admin вставляет плейсхолдер из picker'а; UI совпадает с биллинговыми).
- UI пакета «Идеология»: кнопка «Привязать шаблон документа» → INSERT в `document_package_template_items` + audit `package_template_item_linked` (как в прошлой версии плана).
- `.lovable/plan.md` (Sprint 3D переписан, dry-run отложен в 3E).
- `mem://architecture/documents/package-token-aliases-v1` — обновить: «package placeholders = одна база реквизитов + два контекста; alias'ы FLD-372/373 — переоценить в Sprint 3E после выбора синтаксиса».

**НЕ затрагиваются:** `canonical-document-generate-strict`, существующие billing FLD, `document_token_aliases` (legacy), `package-tokens-dry-run` (создано в 3C, не вызывается).

### 10. DoD

- В разделе «Документы → Плейсхолдеры» отображаются три новые группы: «Пакет: ЮЛ», «Пакет: ИП», «Пакет: ФЛ».
- Состав групп зеркалит «Заказчик ЮЛ / ИП / ФЛ» по labels и количеству для всех полей со статусом `available`; недостающие — в manifest как explicit gap.
- Существующие биллинговые группы и FLD не изменились; биллинговая генерация актов не задета (manual smoke на одном существующем акте — успех).
- Никакие новые FLD не созданы.
- Никакие role-specific группы плейсхолдеров не добавлены.
- Админ может скопировать плейсхолдер и вставить в Word, загрузить шаблон, привязать к пакету «Идеология» через UI (без генерации).
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents` не тронуты; `HARDCODED_ENABLED=false`.
- Proof заполнен (12 секций), включая выбор синтаксиса роль-привязки и manifest gaps.
- Unit-тесты проходят.

### 11. Финальный статус Sprint 3D

`completed: UL/IP/FL package placeholder catalog prepared over existing requisites base; package resolver context documented; Word authoring readiness; no new FLDs created without manifest proof; generation and dry-run deferred to Sprint 3E`

### 12. Sprint 3E (после)

- По manifest создать недостающие FLD (если они нужны и колонки-источники существуют).
- Загрузить реальный DOCX приказа, привязать к пакету «Идеология», вставить UL/IP/FL плейсхолдеры через picker.
- Запустить controlled `package-template-dry-run` на реальном `template_id`, проверить coverage / unresolved.
- Принять решение о нормализации `ideology_responsible` (rename → `responsible_person` или `generic_role_key`-колонка).
- Только после этого — реальная генерация.