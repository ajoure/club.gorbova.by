# Sprint 2.3 — Corrective discovery: package placeholders как единая generic-модель

**Дата:** 2026-05-27
**Тип:** read-only discovery + corrective note (без миграций, без INSERT/UPDATE, без изменений UI-логики, без edge function deploy).
**Статус:** completed.
**Supersedes (частично):** `package_documents_ideology_sprint2_placeholder_namespace_2026_05.md` — раздел про per-package namespaces и вывод «все 8 FLD корпоративные и для идеологии непригодны».

---

## 1. Corrective note: package placeholders are generic, not per-domain

В Sprint 2 закрепилась ошибочная установка: создавать отдельный namespace `documents:package:ideology`, а для будущих пакетов — `documents:package:<code>`. Это ведёт к комбинаторному росту token-доменов и к дублированию реквизитов под каждый пакет.

**Корректная модель:**

- одна база реквизитов: `client_legal_details` (юрлица/ИП) + `legal_details_persons` (физлица);
- **один** generic UI-namespace `documents:package` (technical context-id уточняется в Sprint 3A после аудита текущего picker, см. §6 — anti-fallback rule);
- `document_package_role_catalog` — единственный адаптационный слой пакета: смысл ролей задаётся per-`package_template_id`, generic `role_key` остаются общими;
- идеология ≠ домен токенов, идеология = `package_template` с собственным набором ролей в role catalog.

Запрещено:
- `documents:package:ideology`, `documents:package:corporate_meeting`, `documents:package:<future>` как отдельные token-домены;
- отдельные таблицы реквизитов под пакет;
- автоматическое переименование label существующих FLD без отдельного PATCH с проверкой UI/snapshot/manifest влияния.

---

## 2. Existing package FLD reuse analysis

Discovery (`SELECT public_id, key, label, data_type, archived_at FROM fields_registry WHERE entity_type='package'`) дал **8 записей** (не 10 — диапазон FLD-000099/FLD-000100 отсутствует), все активные (`archived_at IS NULL`), все не используются в активных `document_templates` (полный сканер `editor_draft_content` и `placeholders` по regex `FLD-0000(93|94|95|96|97|98|101|102)` и по `package.%` → 0 строк).

| FLD | key | label | data_type | используется в шаблонах | пригоден как generic | решение |
|-----|-----|-------|-----------|--------------------------|----------------------|---------|
| FLD-000093 | `package.signer.full_name` | ФИО подписанта | text | нет | по смыслу да, но `signer` сейчас читается как «подписант собрания» | `candidate_for_label_generalization_later` — generic эквивалент `package.roles.document_signer.full_name`; решение по reuse vs new — Sprint 3A |
| FLD-000094 | `package.signer.position` | Должность подписанта | text | нет | то же | `candidate_for_label_generalization_later` |
| FLD-000095 | `package.chairperson.full_name` | ФИО председателя | text | нет | нет — узко-процедурный (председатель собрания) | `keep_as_legacy_corporate_token` + `do_not_use_for_ideology` |
| FLD-000096 | `package.secretary.full_name` | ФИО секретаря | text | нет | нет — узко-процедурный | `keep_as_legacy_corporate_token` + `do_not_use_for_ideology` |
| FLD-000097 | `package.participants` | Участники собрания | array | нет | условно — массив участников может быть generic, но label жёстко про собрание | `defer_until_resolver` — generic эквивалент `package.participants[]` потенциально, но решение по reuse только после Sprint 3A manifest |
| FLD-000098 | `package.registered_persons` | Зарегистрированные лица | array | нет | нет — процедура регистрации на собрании | `keep_as_legacy_corporate_token` |
| FLD-000101 | `package.board_candidates` | Кандидаты в совет директоров | array | нет | нет — узко-корпоративный | `keep_as_legacy_corporate_token` |
| FLD-000102 | `package.commission_members` | Члены ревизионной комиссии | array | нет | нет — узко-корпоративный | `keep_as_legacy_corporate_token` |

**Важно:**
- ни один из 8 FLD сейчас не задействован в живых шаблонах → safe не трогать;
- `FLD-000093/094/097` потенциально переиспользуемы, но НЕ автоматически: namespace `package.signer.*` зарезервирован как legacy (см. memory `documents:package`), поэтому generic эквиваленты вводятся под новыми ключами (`package.roles.document_signer.*`, `package.participants[]` — отдельный generic token), а решение «оставить legacy + ввести generic» vs «depricate legacy» откладывается в Sprint 3A;
- FLD-95/96/98/101/102 остаются legacy-corporate, для пакета «Идеология» **не используются**;
- generic роли пакета (`responsible_person`, `document_preparer`, `control_person`, `notified_person`) в `fields_registry` отсутствуют → требуются **новые** generic токены (Sprint 3A manifest, Sprint 3B implementation).

---

## 3. Generic package token model (manifest draft)

UI-группа в picker: **«Пакеты документов»** с подгруппами:

1. Компания пакета
2. Физлица пакета (по ролям)
3. Роли пакета
4. Участники пакета (массивы)
5. Документы пакета / служебные поля

Draft generic token list (финализируется в Sprint 3A approve manifest):

```text
# 1. Компания пакета (source: client_legal_details через package_session.selected_legal_entity_id)
package.company.full_name
package.company.short_name
package.company.unp
package.company.legal_address
package.company.head.full_name
package.company.head.position

# 3. Роли пакета (source: document_package_session_participants ⋈ legal_details_persons по role_key)
package.roles.company_head.full_name
package.roles.responsible_person.full_name
package.roles.document_signer.full_name
package.roles.document_preparer.full_name
package.roles.control_person.full_name

# 4. Участники пакета — массивы (требуют loop/render support, см. §6 риск)
package.participants[].full_name
package.participants[].position
package.notified_persons[].full_name
package.notified_persons[].position
```

### Source mapping (read-only design)

| token prefix | физический источник | scope-якорь |
|---|---|---|
| `package.company.*` | `client_legal_details` | `document_package_sessions.selected_legal_entity_id` |
| `package.company.head.*` | `legal_details_persons` где `is_head=true` для company | `selected_legal_entity_id` |
| `package.roles.<role_key>.*` | `document_package_session_participants` (single) ⋈ `legal_details_persons` | `package_session_id` + `role_key` |
| `package.participants[].*` | `document_package_session_participants` (array) ⋈ `legal_details_persons` | `package_session_id` + `role_key='ideology_participant'` (или generic `participant`) |
| `package.notified_persons[].*` | то же | `role_key='notified_person'` |

**Generic role_key — это не фиксированный закрытый список.** Будущие пакеты могут добавлять новые `role_key` в `document_package_role_catalog`. Generic = одна модель резолва (session → participants → persons), а не один фиксированный набор ролей. Запрещено только одно: создавать под новую роль отдельный token namespace.

---

## 4. Role catalog as package-specific adaptation layer

Snapshot текущих 11 ролей пакета «Идеология» (`document_package_role_catalog`, sort_order):

| sort | role_key | label «Идеология» | required | min/max | allowed_entity_types | generic mapping |
|---|---|---|---|---|---|---|
| 10 | `package_company` | Организация пакета | true | 1/1 | legal_entity, entrepreneur | generic root (привязка к `selected_legal_entity_id`) |
| 20 | `company_head` | Руководитель организации | true | 1/1 | person | `package.roles.company_head.*` |
| 30 | `ideology_responsible` | Ответственный за идеологическую работу | true | 1/1 | person | generic role_key = `responsible_person` (предложение Sprint 3A: переименовать `ideology_responsible` → `responsible_person`, label остаётся per-package) |
| 40 | `document_signer` | Подписант документов | false | 0/1 | person | уже generic |
| 50 | `document_preparer` | Составитель документов | false | 0/1 | person | уже generic |
| 60 | `control_person` | Контролирующее лицо | false | 0/1 | person | уже generic |
| 70 | `ideology_active_member` | Член идеологического актива | false | 0/∞ | person | per-package role (специфичен идеологии, generic эквивалент — не нужен) |
| 80 | `ideology_participant` | Участник мероприятий | false | 0/∞ | person | generic `participant` (предложение Sprint 3A: ввести generic `participant` + per-package label) |
| 90 | `notified_person` | Ознакомленное лицо | false | 0/∞ | person | уже generic |
| 100 | `report_participant` | Участник отчёта | false | 0/∞ | person | per-package или generic — решение Sprint 3A |
| 110 | `external_specialist` | Внешний специалист/организация | false | 0/∞ | legal_entity, entrepreneur, person | per-package, generic не требуется |

**Правило:** generic `role_key` (company_head, responsible_person, document_signer, document_preparer, control_person, participant, notified_person) — общая основа резолвера. Per-package `role_key` (ideology_active_member, report_participant, external_specialist, …) допустимы и адаптируются через тот же catalog без новых token namespaces.

Переименование `ideology_responsible` → `responsible_person` и `ideology_participant` → `participant` — **предложение, не действие**. Любая ALTER операция в Sprint 2.3 запрещена; решение принимается в Sprint 3A.

---

## 5. Why ideology must not have isolated token namespace

1. Реквизиты юрлица и физлица — общие для всех пакетов; дублирование = расхождение SOT.
2. Резолвер `package_session_id → participants → role_catalog → legal_details_persons` одинаков для любого пакета.
3. Per-package namespace ведёт к комбинаторному взрыву: N пакетов × M ролей = N·M token-доменов вместо одного.
4. Шаблоны конкретного пакета остаются специфичны (тексты, структура), но **токены** — generic. Per-package — только labels в role catalog.
5. Protected billing templates (счета-акты с FLD актов выполненных работ) **не пересекаются** с package namespace — это разные categories в `document_token_registry`. Package generic токены не переиспользуют FLD актов и не модифицируют их.

→ Memory-правило (черновик для Core, утверждается отдельно):
> **Package placeholders — единый generic namespace `documents:package`** (technical context-id финализируется в Sprint 3A). **Per-package token namespaces запрещены.** Адаптация пакета — только через `document_package_role_catalog` и `document_package_sessions.package_template_id`. Generic role_keys расширяемы; запрещено только введение отдельного token-домена под пакет.

---

## 6. Updated roadmap

- **Sprint 2.3 (этот)** — corrective discovery, read-only. ✅ выполнено.
- **Sprint 3A — Approve final generic token manifest.** Read-only/design-only.
  - аудит текущего picker (`TokenizedRichInput` + `tokenRegistry.ts`), выбор технического context-id;
  - финальный manifest generic токенов (с подтверждением: какие FLD-93/94/97 переиспользуются vs новые);
  - финальное решение по generic role_keys (responsible_person, participant);
  - проверка массивных токенов (`participants[]`, `notified_persons[]`) на совместимость с текущим resolver движком (DOCX loop / docxtemplater {#…}{/…});
  - явное подтверждение защищённости billing templates;
  - **без** изменений в БД и коде.
- **Sprint 3B — Registry implementation + picker grouping + resolver skeleton.** После approve 3A:
  - INSERT generic токенов в `document_token_registry` под единый `category`;
  - расширение `tokenRegistry.ts` группой «Пакеты документов»;
  - skeleton package resolver поверх `document_package_sessions` + `_participants` + `role_catalog` + `client_legal_details` + `legal_details_persons` (без подключения к `canonical-document-generate-strict`).
- **Sprint 4 — Package generation.** Только после Sprint 3B:
  - генерация одного документа и пакета, `package_session_id` в snapshot, source_trace, warnings, validation.

---

## 7. Финальный статус Sprint 2

**`completed with correction: package placeholders must be generic; existing package FLD partially reusable; new generic package tokens required in Sprint 3B; implementation deferred.`**

Детально:
- 5 из 8 существующих FLD (`95/96/98/101/102`) — узко-корпоративные legacy, для идеологии и других пакетов **не использовать**, не удалять.
- 3 из 8 (`93/94/97`) — кандидаты на label-генерализацию, но решение по reuse vs новые FLD откладывается до Sprint 3A approve manifest.
- Generic роли `responsible_person`, `document_preparer`, `control_person`, `notified_person`, `participant` в `fields_registry` отсутствуют → создаются в Sprint 3B как новые generic токены под единый namespace.
- Идеология НЕ получает отдельного token namespace ни сейчас, ни в будущем.

---

## 8. DoD Sprint 2.3 — проверка

- [x] Corrective proof со всеми 7 секциями создан.
- [x] Таблица по 8 FLD заполнена с решениями из закрытого списка.
- [x] Generic token manifest (draft) зафиксирован + source mapping.
- [x] Role catalog mapping (generic ↔ ideology labels) зафиксирован.
- [x] Roadmap разбит на Sprint 3A / Sprint 3B / Sprint 4.
- [x] Sprint 2 proof помечен как superseded в части per-package namespace.
- [x] Memory-правило (черновик) описано в §5.
- [x] Ни одного `INSERT/UPDATE/ALTER/CREATE` в БД, ни одного edge function deploy, ни одного изменения UI-логики.
- [x] Приложенный шаблон счета-акта остаётся protected billing template; его FLD не переиспользуются для package tokens и не меняются.

---

## 9. STOP / anti-fallback rules

- Не начинать Sprint 3A до approve этого corrective proof.
- Не трогать FLD актов выполненных работ.
- Не создавать `documents:package:ideology` ни в коде, ни в registry, ни в плане.
- Не создавать дублирующие таблицы реквизитов.
- Не подключать генерацию документов.
- **Anti-fallback:** если конкретный generic token не разрешается из package_session → возвращать explicit warning + `unresolved`, **не** падать в legacy `package.signer.*` / `package.chairperson.*` / любой другой legacy-corporate FLD.
- Если после Sprint 3A окажется, что FLD-93/94/97 непригодны как generic — это **не blocker**; Sprint 3B создаёт новые generic токены, legacy остаются нетронутыми.
