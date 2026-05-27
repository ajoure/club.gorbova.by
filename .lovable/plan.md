# да, согласен, с учетом правок:

1. **Название спринта корректное, но нужно явно указать superseded-логику**
  &nbsp;
  Добавить в начало:
2. **Уточнить: generic namespace не означает один фиксированный список ролей навсегда**
  &nbsp;
  Сейчас можно неверно понять, что все будущие роли должны быть только из списка:
  ```text
  company_head, responsible_person, document_signer...
  ```
  Добавить:
3. **Не “переименовать label позже” без проверки влияния на UI**
  &nbsp;
  В решениях по FLD заменить:
  ```md
  rename_label_only_later
  ```
  на более безопасное:
  ```md
  candidate_for_label_generalization_later
  ```
  Потому что даже label может быть связан с UX, документацией, manifest или snapshot. Любое переименование — отдельный PATCH.
4. **Уточнить, что** `FLD-000093…102` **нельзя автоматически считать generic**
  &nbsp;
  Добавить:
5. **Добавить проверку source resolver для старых package FLD**
  &nbsp;
  В discovery-шаги добавить:
6. **Не фиксировать** `documents:package` **как единственный technical context, пока не проверен текущий picker**
  &nbsp;
  Формулировку лучше сделать так:
7. **Добавить проверку массивов как отдельный риск**
  &nbsp;
  Токены:
  ```text
  package.participants[]
  package.notified_persons[]
  ```
  могут требовать loop/render support. Добавить:
8. **Добавить связь generic tokens с package_session scope**
  &nbsp;
  В generic source mapping добавить:
9. **Добавить explicit anti-fallback rule**
10. **Добавить proof по сохранению billing template**

В DoD добавить:

```md
Приложенный шаблон счета-акта остается protected billing template.
Его FLD не переиспользуются для package tokens и не меняются.
```

11. **Roadmap после Sprint 2.3 скорректировать**

В Sprint 3 лучше не писать сразу “создать/переиспользовать tokens”, а разделить:

```md
Sprint 3A — approve final generic token manifest.
Sprint 3B — registry implementation + picker grouping + resolver skeleton.
Sprint 4 — generation.
```

Иначе Lovable может сразу полезть в registry до утверждения финального manifest.

12. **Добавить финальный STOP**

```md
Если после Sprint 2.3 окажется, что существующие FLD-000093…102 не подходят как generic, это не blocker. В таком случае Sprint 3 должен создать новый generic manifest, но только после approve.
```

В остальном план правильный. Главное: **пакеты документов должны использовать общие реквизиты и generic package placeholders, а смысл конкретного пакета задается через** `package_code` **и** `document_package_role_catalog`**, не через отдельный namespace токенов.**

&nbsp;

План: Sprint 2.3 — Corrective discovery package placeholders (generic model)

## 0. Причина

В отчете Sprint 2 закрепился ошибочный вывод: «делаем отдельный namespace `documents:package:ideology`, а старые 8 FLD `entity_type='package'` относятся только к корпоративным собраниям и для идеологии непригодны». Это ведёт к плодению доменов под каждый будущий пакет и к дублированию реквизитов.

Правильная модель: **одна база реквизитов (юрлица/ИП/физлица) + один generic namespace `documents:package` + role catalog как адаптационный слой пакета**. Идеология — это просто `package_code='ideology'` со своими ярлыками ролей, а не отдельный токен-домен.

## 1. Жёсткие правила

- Только русский в артефактах, proof, audit, code-комментариях.
- Порядок: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY.
- Sprint 2.3 — **read-only**. Никаких миграций, INSERT/UPDATE, изменений edge functions, изменений UI-логики.
- Все связи — только UUID/id. Запрещено матчить по названию/УНП/email/slug/тексту.
- STOP-зоны (не трогать ни в discovery, ни в последующих спринтах без отдельного approve): `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`, `allocate_document_number`, `document_scenarios`, billing/customer/executor resolver, существующие FLD актов выполненных работ, signature `canonical-document-generate-strict`.
- Запрещено: отдельные token-домены под пакет, отдельные реквизиты под «Идеологию», дублирование `client_legal_details` / `legal_details_persons`.

## 2. Что пересмотреть в Sprint 2

Вывод «8 FLD `entity_type='package'` принадлежат домену корпоративных собраний и к идеологии не относятся» — переоценить. Для каждого FLD (FLD-000093 … FLD-000102) собрать таблицу:

| FLD | текущий label | canonical key | source | используется в шаблонах | пригоден как generic package token | решение |

Решения из закрытого списка:

- `reuse_as_generic_package_token` — токен по сути про роль/участника/компанию, переименовать label позже, оставить ID.
- `keep_as_legacy_corporate_token` — токен узко про процедуру собрания (председатель собрания, секретарь собрания, кандидат в совет), не использовать для других пакетов.
- `rename_label_only_later` — generic по смыслу, но текущий label привязан к собраниям.
- `do_not_use_for_ideology` — узкий legacy, для идеологии нужен новый generic.
- `needs_new_generic_token` — generic роли (responsible_person, document_preparer, control_person, notified_person) сейчас нет, требуется новый.
- `defer_until_resolver` — решение откладывается до проектирования resolver в Sprint 3.

Если FLD нигде не используется в активных шаблонах — не удалять и не пересоздавать без анализа.

## 3. Целевая generic-модель (документируется, не реализуется)

Единая UI-группа в picker: **«Пакеты документов»** с подгруппами:

1. Компания пакета
2. Физлица пакета
3. Роли пакета
4. Участники пакета
5. Документы пакета / служебные поля

Generic token list (черновой, финализируется в proof):

```text
package.company.full_name
package.company.short_name
package.company.unp
package.company.legal_address
package.company.head.full_name
package.company.head.position

package.roles.company_head.full_name
package.roles.responsible_person.full_name
package.roles.document_signer.full_name
package.roles.document_preparer.full_name
package.roles.control_person.full_name

package.participants[].full_name
package.participants[].position
package.notified_persons[].full_name
package.notified_persons[].position
```

Никаких `documents:package:ideology`, `documents:package:corporate_meeting`, `documents:package:<future>`. Единственный контекст — `documents:package`.

## 4. Role catalog как адаптационный слой

`document_package_role_catalog` — единственное место, где пакет задаёт смысл ролей. Generic role_key остаётся общим, label меняется per-package.


| generic role_key   | label в «Идеология»                    |
| ------------------ | -------------------------------------- |
| company_head       | Руководитель организации               |
| responsible_person | Ответственный за идеологическую работу |
| document_signer    | Подписант документов                   |
| document_preparer  | Составитель документов                 |
| control_person     | Лицо, контролирующее исполнение        |
| participant        | Участник идеологической работы         |
| notified_person    | Ознакомленное лицо                     |


Новый пакет = новые записи в role catalog + новый `package_code` + (опционально) новые role_keys. **Никогда** не новый token namespace.

## 5. Артефакт спринта (single deliverable)

Один proof-файл: `.lovable/proofs/package_documents_sprint2_3_generic_model_correction_2026_05.md`

Структура:

1. Corrective note: package placeholders are generic, not per-domain.
2. Existing package FLD reuse analysis (таблица по 8 FLD + решения).
3. Generic package token model (финальный список токенов + source mapping на `document_package_sessions` / `_participants` / `client_legal_details` / `legal_details_persons`).
4. Role catalog as package-specific adaptation layer (snapshot текущих ролей «Идеологии» + mapping на generic role_keys).
5. Why ideology must not have isolated token namespace (явный запрет в memory).
6. Updated roadmap: Sprint 2.3 (этот) → Sprint 3 (generic tokens + resolver) → Sprint 4 (generation).
7. Финальный статус Sprint 2 — одно из трёх:
  - `completed with correction: package placeholders must be generic; implementation deferred to Sprint 3`
  - `completed with correction: existing package FLD are legacy-specific; new generic package tokens required in Sprint 3`
  - `partial: package FLD classification requires additional review`

Дополнительно — обновить `.lovable/plan.md` (заменить блок Sprint 3/4 на новый roadmap) и `.lovable/proofs/package_documents_ideology_sprint2_placeholder_namespace_2026_05.md` (вставить ссылку на corrective proof и пометить ошибочные выводы как superseded).

## 6. Discovery-шаги (read-only)

1. `SELECT` по `fields_registry` где `entity_type='package'` — полный список 8 FLD с label, key, source, meta.
2. `SELECT` по `document_token_registry` где `category` пересекается с package — посмотреть category/token_key/field_id.
3. Поиск использования каждого FLD в активных `document_templates` (regex по `{{field:FLD-XXXXXX}}` и по canonical token_key).
4. `SELECT` по `document_package_role_catalog` — текущие 11 ролей идеологии + их generic-эквиваленты.
5. Проверка `document_package_sessions` / `_participants` schema — какие источники данных уже доступны для resolver (без проектирования самого resolver — это Sprint 3).
6. Заполнение таблицы решений из §2 и финального generic token list из §3.

## 7. Roadmap после Sprint 2.3

- **Sprint 3 — Generic package tokens + resolver**: создать/переиспользовать generic package tokens в `documents:package` (один namespace), спроектировать package resolver поверх `document_package_sessions` + `_participants` + `role_catalog` + `client_legal_details` + `legal_details_persons`; picker показывает одну группу «Пакеты документов»; role labels подтягиваются из role catalog текущего `package_code`.
- **Sprint 4 — Package generation**: генерация одного документа и всего пакета, `package_session_id` в snapshot, source_trace, warnings, validation. Только после Sprint 3.

## 8. DoD Sprint 2.3

- Создан corrective proof со всеми 7 секциями.
- Таблица по 8 FLD заполнена, каждому присвоено решение из закрытого списка.
- Финальный generic token list зафиксирован + source mapping.
- Role catalog mapping (generic role_key ↔ label «Идеологии») зафиксирован.
- Roadmap в `.lovable/plan.md` обновлён.
- Sprint 2 proof помечен как superseded в части ошибочного namespace-разделения.
- Memory-правило (черновик для core): «package placeholders — единый generic namespace `documents:package`; per-package token namespaces запрещены; адаптация пакета — только через `document_package_role_catalog` и `package_code`».
- Ни одного `INSERT/UPDATE/ALTER/CREATE` в БД, ни одного edge function deploy, ни одного изменения UI-логики.

## 9. STOP

- Не начинать Sprint 3 до approve corrective proof.
- Не трогать существующие FLD актов выполненных работ.
- Не создавать `documents:package:ideology` ни в коде, ни в registry, ни в плане.
- Не создавать дублирующие таблицы реквизитов под идеологию или любой будущий пакет.
- Не подключать генерацию документов.