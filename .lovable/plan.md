# да, согласен, с учетом правок:

## **1. Главное: правка правильная**

Новый принцип **billing-only** нужно принять как обязательный:

```sql
client_legal_details.purpose = 'billing'
AND client_legal_details.client_type IN ('legal_entity', 'entrepreneur')
```

Это правильно защищает систему от мусора из document-flow: чужих контрагентов, тестовых реквизитов, данных для договоров и генерации документов.

`purpose='document'`, `legal_details_persons`, `legal_details_entity_person_links` — **не должны автоматически создавать CRM companies**.

---





## **2. Важная правка: не удалять**

`company_contact_person_map` **без отдельного решения**

Я бы **не удалял** `company_contact_person_map` **из master-plan полностью**.

Правильнее так:

```text
Phase 1 core tables:
- companies
- company_contacts
- client_legal_details_company_map
- company_sync_queue
```

А `company_contact_person_map` перенести в:

```text
Deferred / Phase 10+ / Documents compatibility follow-up
```

Почему: сейчас мы не используем `legal_details_persons` для auto-CRM, но в будущем для корпоративных документов связь “подписант документа ↔ company/contact” может понадобиться. Удалять идею полностью не нужно, нужно убрать её из **автоматического CRM backfill**.

Формулировка:

```text
company_contact_person_map не создаётся в Phase 1 и не участвует в CRM auto-source.
Возможность такой compat-таблицы оставляется как deferred для Phase 10 Documents compatibility, только после отдельного approval.
```

---

## **3. Закрытый список таблиц Phase 1 — принять, но формулировать аккуратно**

Принять:

```text
Phase 1 разрешённые таблицы:
- companies
- company_contacts
- client_legal_details_company_map
- company_sync_queue
```

Но добавить:

```text
Это закрытый список только для CRM Companies core Phase 1.
Любая дополнительная таблица, включая document/person compat tables, запрещена без отдельного duplicate discovery + approval.
```

---





## **4.**

`company_contacts.source enum` **лучше не делать PostgreSQL ENUM**

В плане написано:

```text
company_contacts.source enum
```

Лучше заменить на:

```text
company_contacts.source text CHECK (...)
```

Или справочник, если уже есть паттерн catalog tables.

Значения:

```text
billing_requisites
manual
import
call_center
admin_link
document_review
```

Причина: источники будут расширяться. PostgreSQL ENUM потом сложнее менять.

---











## **5. Role для billing-связи лучше не**

`owner`**, а** `billing_owner` **или** `billing_contact`

В Phase 3 написано:

```text
роль owner
```

Это может конфликтовать с реальным владельцем юрлица. Клиент, который добавил биллинговые реквизиты, не всегда юридический собственник компании.

Лучше:

```text
relationship_type = 'billing_contact'
source = 'billing_requisites'
is_billing_contact = true
```

Если нужно оставить “owner”, то только если он действительно владелец компании, а не просто клиент ЛК.

---

## **6. Правило совпадения УНП — принять**

Правильно:

```text
Если УНП уже есть:
- новую company не создаём;
- создаём client_legal_details_company_map;
- создаём/обновляем company_contacts для profile клиента;
- критичные поля company не перезаписываем;
- расхождения идут в review.
```

Добавить только:

```text
Если existing company archived/merged — не линковать напрямую, а следовать merged_into_id или отправить в review.
```

---





## **7.**

`legal_entities_requisites` **— только как secondary mirror**

Правило правильное, но нужно усилить:

```text
legal_entities_requisites не является самостоятельным источником CRM companies.
Используется только как secondary mirror, если source_legacy_id ведёт на billing client_legal_details.
Если source_legacy_id отсутствует — не участвует в auto-backfill.
```

---

## **8. Что отправить подрядчику как финальную правку**

```text
План Master Plan v2 согласован, с учетом обязательных правок:

1. Billing-only source rule принять:
client_legal_details.purpose='billing'
AND client_legal_details.client_type IN ('legal_entity','entrepreneur').

2. purpose='document', legal_details_persons, legal_details_entity_person_links, document packages, AI-document requisites не создают companies/company_contacts автоматически.

3. legal_entities_requisites использовать только как secondary mirror, если source_legacy_id указывает на billing client_legal_details. Без source_legacy_id — excluded from CRM auto-source.

4. Phase 1 закрытый список core-таблиц:
- companies
- company_contacts
- client_legal_details_company_map
- company_sync_queue

5. company_contact_person_map не создавать в Phase 1 и не использовать в CRM auto-backfill. Не удалять идею полностью: перенести в deferred для Phase 10 Documents compatibility / отдельный approved follow-up.

6. company_contacts.source не делать PostgreSQL ENUM. Использовать text CHECK или справочник. Значения:
billing_requisites / manual / import / call_center / admin_link / document_review.

7. Для связи из billing-реквизитов не использовать relationship_type='owner' по умолчанию. Использовать:
relationship_type='billing_contact'
source='billing_requisites'
is_billing_contact=true

8. При совпадении УНП:
- не создавать новую company;
- создать client_legal_details_company_map;
- создать/обновить company_contacts для profile клиента;
- не перезаписывать name/legal_form/УНП без review;
- если company archived/merged — следовать merged_into_id или отправлять в review.

9. Discovery 0.1 должен сохранить вывод: legal_details_persons.profile_id = владелец ЛК, не подписант. Поэтому LDP/LEPL исключены из CRM auto-source.

10. После внесения этих правок можно переходить к отдельному документу:
План: CRM Companies — Phase 1 Canonical Data Model.
```

## **Итог**

План v2 правильный. Основная логика теперь безопасная:

```text
billing-реквизиты ЛК → canonical companies
document-реквизиты → остаются только document compatibility layer
legal_details_persons → не auto-source
client_legal_details → не ломаем
companies → CRM-слой поверх billing-реквизитов

обнови полностью мастер план итоговый

План: Master Plan v2 — уточнение источников для CRM Companies
```

Обновляю `.lovable/architecture/companies_master_implementation_plan.md` и `.lovable/architecture/companies_sprint_discovery_0_1.md` под ваше правило. Код и БД не трогаются. Отдельный документ Phase 1 (DDL/RLS/rollback) — следующим шагом, после утверждения этой правки.

## Ключевое правило (новый §3.1 в Master Plan)

**Источник CRM companies = только билинговые реквизиты юрлиц/ИП из ЛК:**

```
client_legal_details.purpose = 'billing'
AND client_legal_details.client_type IN ('legal_entity', 'entrepreneur')
```

Всё остальное — `purpose = 'document'`, физлица, реквизиты пакетов документов, `legal_details_persons`, `legal_details_entity_person_links` — **не создаёт и не изменяет `companies` / `company_contacts` автоматически**. Живёт своей жизнью как document compatibility layer.

## Что удаляется из плана

- **Phase 1:** убирается таблица `company_contact_person_map`. Разрешённый закрытый список таблиц: `companies`, `company_contacts`, `client_legal_details_company_map`, `company_sync_queue`. Любая новая таблица по юрлицам — только через отдельный duplicate discovery + approval.
- **Phase 3:** удаляются шаги 5–6 (backfill `company_contacts` из `legal_details_entity_person_links` + ФИО-matcher + review-очередь по persons).
- **Discovery 0.1 §3:** правило про `legal_details_persons.profile_id` остаётся как обоснование "почему не используем", но выводы про matcher/review-очередь удаляются.

## Что добавляется в план

### §3.1 Source rules (новый раздел Master Plan)

1. Единственный auto-источник companies: billing legal_entity/entrepreneur из `client_legal_details`.
2. `purpose='document'` реквизиты: не создают company, не создают company_contact, не участвуют в базе прозвона, не участвуют в auto-dedupe, не перезаписывают карточку. Только ручная привязка админом или отдельный approved matcher в будущей фазе.
3. `legal_entities_requisites` учитывается только если `source_legacy_id` ссылается на billing legal_entity/entrepreneur в `client_legal_details`.
4. `client_legal_details` не удаляется и не заменяется — остаётся working compat SOT для billing и document процессов. `companies` = canonical CRM layer поверх billing-реквизитов, не замена storage.

### Phase 3 (Backfill) — source guard

```sql
-- included
WHERE cld.purpose = 'billing'
  AND cld.client_type IN ('legal_entity', 'entrepreneur')

-- excluded, логируется в dry-run отчёт с reason:
--   'document_purpose_not_crm_company_source'
--   'client_type_individual_not_crm_company_source'
```

Backfill `company_contacts` в Phase 3: один контакт на компанию — владелец ЛК-карточки (`client_legal_details.profile_id`, роль `owner`, `source='billing_requisites'`). Никаких matcher-ов по persons.

### Phase 4 (ЛК → Company sync) — sync guard

RPC `crm_company_upsert_from_legal_details(legal_details_id)`:

- Если `purpose != 'billing'` OR `client_type NOT IN ('legal_entity','entrepreneur')` → skip, лог `sync_skipped_not_billing_company`, return NULL. Ошибкой не считается.
- Если billing legal_entity/entrepreneur → upsert по normalized UNP.

### Правило совпадения УНП (Phase 3 + Phase 4)

При existing company по normalized UNP:

1. Новую company НЕ создаём.
2. Создаём новую запись `client_legal_details_company_map` (ЛК другого клиента ↔ existing company).
3. Создаём/обновляем `company_contacts` для `client_legal_details.profile_id` этого клиента (роль owner, `source='billing_requisites'`).
4. Критичные поля company (display_name, legal_form, УНП) **не перезаписываются**. При расхождении display_name/legal_form → review-запись.
5. Все связи сохраняют `source='billing_requisites'`.

### `company_contacts.source` enum

```
'billing_requisites' | 'manual' | 'import' | 'call_center' | 'admin_link' | 'document_review'
```

Отображается в UI (Phase 7/8) во вкладке «Контакты» карточки компании — колонка Source.

### Freeze list таблиц (§5)

Добавляется пункт: закрытый список таблиц юрлиц = `companies`, `company_contacts`, `client_legal_details_company_map`, `company_sync_queue`. Любая новая параллельная таблица — запрещена без отдельного discovery + approval.

## Изменения по фазам (сводно)


| Phase | Изменение                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Удалить `company_contact_person_map`. Оставить 3 таблицы + queue. Добавить enum `company_contact_source`.                                          |
| 2     | В RPC `crm_company_upsert_from_legal_details` добавить source guard (skip non-billing).                                                            |
| 3     | Backfill только billing legal_entity/entrepreneur. Contacts — только owner ЛК. Убрать persons matcher. Dry-run отчёт с секцией excluded-by-reason. |
| 4     | Sync guard в RPC + UI-hook. UNP-collision правило (map + owner-contact, без overwrite).                                                            |
| 5–6   | Без изменений в подходе.                                                                                                                           |
| 7     | Во вкладке «Контакты» карточки компании — колонка Source.                                                                                          |
| 8–11  | Без изменений в подходе.                                                                                                                           |


## Что НЕ делаю в этой правке

- Не создаю таблицы, миграции, RPC, edge, UI.
- Не пишу отдельный документ Phase 1 (DDL) — это следующий approval после утверждения правки Master Plan.
- Не трогаю `legal_details_persons`, `legal_details_entity_person_links`, `client_legal_details`, document-flows.

## Файлы к изменению (только markdown)

- `.lovable/architecture/companies_master_implementation_plan.md` — §3.1 source rules, §4 удалить `company_contact_person_map`, §5 добавить закрытый список таблиц, Phase 1/2/3/4/7 переписать под правило.
- `.lovable/architecture/companies_sprint_discovery_0_1.md` — §3 переформулировать (persons/entity_person_links = excluded from CRM auto-flow), §6 checklist оставить = yes.
- `.lovable/proofs/companies_dependency_map_0_1.md` — пометить `legal_details_persons` и `legal_details_entity_person_links` как **excluded from CRM auto-source**.
- `.lovable/plan.md` — короткая запись «Master Plan v2: source guard принят».

## DoD

- Master Plan содержит §3.1 с полным правилом источников (billing only + 10 пунктов).
- Phase 1 в плане содержит закрытый список 4 таблиц.
- Phase 3 содержит SQL-guard и таксономию excluded-reasons.
- Phase 4 содержит sync guard + UNP-collision правило (map + owner-contact, без overwrite).
- Discovery 0.1 не содержит упоминаний matcher/review-очереди по persons.
- Dependency map помечает persons/entity_person_links как excluded from CRM auto-source.