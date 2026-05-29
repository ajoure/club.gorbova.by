# Sprint 3G — Document-level questionnaires + validator + resolver scope

Дата: 2026-05-29
Скоуп: пакеты документов → переход от «одной анкеты на пакет» к «анкета на каждый
документ пакета»; валидатор различает биллинговые vs системные FLD;
резолвер пакетных токенов получает document-level ветку (HARDCODED_ENABLED=false).

## 0. Архитектурное изменение

Было: одна `document_package_sessions` + один набор `document_package_session_participants`
на весь пакет → все шаблоны пакета вынужденно разделяли одни и те же роли/физлица.

Стало:
- `document_package_sessions` — общая «организация» пакета (ЮЛ-плательщик и метаданные).
- `document_package_item_role_assignments` — отдельный набор назначений на каждую
  пару `(package_session_id, package_template_item_id)`. Один человек может быть в
  разных ролях в разных документах одного пакета; одна роль в одном документе может
  быть назначена нескольким физлицам.
- `document_package_session_participants` остаётся read-only legacy: новые UI-флоу
  туда не пишут (см. backlog «document_package_session_save_atomicity»).

## 1. Миграция

`20260529133454_e6c7821e-b608-4a1c-87a2-f25becc13de9.sql`:

```text
TABLE document_package_item_role_assignments (
  id, package_session_id, package_template_item_id, role_catalog_id,
  person_id, metadata jsonb, sort_order, is_active, created_by, updated_by,
  created_at, updated_at
)
```

- GRANT authenticated + service_role; RLS owner/admin-only.
- Триггер `dpira_assert_package_match` — проверяет, что `role_catalog_id`,
  `package_template_item_id` и `package_session_id` принадлежат одному
  `package_template_id`. Любое несовпадение → exception.
- Partial unique index `(package_session_id, package_template_item_id,
  role_catalog_id, person_id) WHERE is_active = true` — нет дублей активных
  назначений того же физлица на ту же роль в том же документе.
- `updated_at` авто-trigger.
- Audit-логирование делается в edge/UI слое (см. hook).

## 2. UI

- `DocumentPackageQuestionnairesView.tsx` — основной экран новой подвкладки
  «Анкеты документов». Глобальный селектор ЮЛ пакета сверху, ниже — accordion
  по `document_package_template_items` (по одному документу пакета). В каждом
  блоке: список ролей пакета + multi-add физлиц.
- `useDocumentItemRoleAssignments(sessionId, itemId)` — replace-save:
  soft-archive активных + insert новых. Атомарный RPC `replace_item_role_assignments`
  отложен в backlog `document_package_session_save_atomicity`.
- `PackagesWorkspace.tsx` — вкладка «Анкета пакета» заменена на «Анкеты документов»
  (новый компонент).
- `useDocumentPackageSession` остался без изменений в этой фазе: продолжает
  держать сессию + ЮЛ. Очистка legacy participant-CRUD — следующая фаза 3H.

## 3. Validator (`PackageTemplateValidationPanel.tsx`)

- Подгружает `fields_registry.entity_type` для всех FLD, упомянутых в шаблонах
  пакета.
- `{{field:FLD-XXXXXX}}` с `entity_type ∈ billing` (см. `src/utils/billingFldGroups.ts`)
  в package-template → warning `billing_fld_in_package_scope` с RU-сообщением.
- `{{field:FLD-XXXXXX}}` с `entity_type` системных/документных групп → valid,
  без warning.
- `{{package.ul|ip|fl.FLD-...}}` и `{{package.role.PKR-...}}` — оставлены как в
  Sprint 3F.
- `{{package.roles.<role_key>.*}}` — deprecated warning (поведение не менялось).

## 4. Resolver (`supabase/functions/_shared/resolve-package-tokens.ts`)

- `PackageTokenResolveInput.packageTemplateItemId?: string | null` — новое поле.
- Когда задан → резолвер находит `document_package_role_catalog.id` по
  (`package_template_id` шаблона-документа, `role_key`) и читает только
  `document_package_item_role_assignments` (active). Иначе — старая ветка
  `document_package_session_participants`.
- Контракт `multiple_role_assignments` (warning при >1 назначениях) сохранён
  и для document-level; multi-add из UI на данном этапе валиден, но при
  попытке резолва приведёт к warning — для real generation в Sprint 3H будет
  введён `output_template` с массивом значений.
- HARDCODED_ENABLED остаётся `false` — production не зовёт резолвер, изменение
  безопасно как дополнение pure-логики.

## 5. Не трогается

- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`,
  billing resolver, `document_package_token_aliases` — без изменений.
- Сидовые/системные роли пакета — поведение из Sprint 3F Phase 2e (hard delete)
  не меняется.
- HARDCODED_ENABLED в резолвере остаётся `false`.

## 6. Файлы

- migration: `supabase/migrations/20260529133454_e6c7821e-b608-4a1c-87a2-f25becc13de9.sql`
- hook: `src/hooks/useDocumentItemRoleAssignments.ts`
- ui: `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`,
  `PackagesWorkspace.tsx` (rewire), `PackageTemplateValidationPanel.tsx` (billing scope)
- util: `src/utils/billingFldGroups.ts`
- resolver: `supabase/functions/_shared/resolve-package-tokens.ts` (document-level branch)

## 7. DoD verification (Sprint 3G closeout, 2026-05-29)

Метод: read-only обход (rg + supabase read_query). Никаких изменений кода
не вносилось.

### 7.1 PKR-каталог UI — PASS (с уточнением канона токена)

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` рендерит группу
  «Пакет: Роли» через табличный `<Table>` с русскими колонками (Название /
  Поле / Источник / Плейсхолдер / Копировать) — тот же layout, что и для
  остальных групп каталога.
- Loader (line 289) читает `document_package_role_catalog` только как
  data-source для `usePackageRoleCatalog`, в DOM строки таблицы попадают
  уже как item-fields (`label_ru`, `reused_fld`, `package_token`).
- Технические поля `tech_key`, `source_path`, `role_key`, `billing_fld_analog`
  показываются ТОЛЬКО под `isSuperAdmin` guard (line 858–877). В обычном UI
  их нет, raw JSON не рендерится.
- copy-token canon в этом репозитории — **`{{ln-XXXXXX}}`** (см.
  `src/utils/packagePlaceholderCatalog.ts::ln`, тесты
  `packagePlaceholderCatalog.test.ts`, `PackageRolesManager.tsx`,
  `StrictDocumentTemplatesManager.tsx`). Это сознательно укороченный
  Word-friendly синоним «`package.role.PKR-XXXXXX`» из плана: семантика та же
  (один токен на роль, PKR-id внутри), форма короче, чтобы Word не ломал
  плейсхолдер по точкам. Дальше по proof везде где встречается
  `{{package.role.PKR-…}}` — следует читать как `{{ln-XXXXXX}}`.

Вердикт: **PASS**. Канон токена явно зафиксирован: `{{ln-XXXXXX}}`.

### 7.2 System FLD validation — PASS

`supabase--read_query` по `fields_registry`:

```text
FLD-000069  entity_type=document   «Номер документа»
FLD-000209  entity_type=system     «Сегодня прописью»
FLD-000211  entity_type=system     «Текущий год»
```

`src/utils/billingFldGroups.ts::BILLING_FLD_ENTITY_TYPES` = `{customer,
customer_ent, customer_ind, customer_leg, customer_signer, executor,
executor_leg}`. Ни `document`, ни `system` в наборе нет →
`PackageTemplateValidationPanel.tsx` НЕ помечает эти FLD как
`billing_fld_in_package_scope`. Все три → **valid, без warning**.

### 7.3 Billing FLD validation — PASS

В валидаторе любая ссылка `{{field:FLD-XXXXXX}}` с
`fields_registry.entity_type ∈ BILLING_FLD_ENTITY_TYPES` (Заказчик ЮЛ/ИП/ФЛ,
Исполнитель ЮЛ) дает severity `warning` с кодом
`billing_fld_in_package_scope`, не error — error путь зарезервирован для
`pkr_not_found` / `pkr_outside_bound_package`.

### 7.4 role_assignment_missing — GAP (запланировано на Sprint 3H)

`rg -n "role_assignment_missing" src/ supabase/` → 0 совпадений.

`PackageTemplateValidationPanel.tsx` сегодня умеет:
`pkr_not_found`, `pkr_outside_bound_package`, `billing_fld_in_package_scope`,
deprecated `{{package.roles.<key>.*}}`. Контроля «в DOCX есть
`{{ln-XXXXXX}}`, но для `(package_session_id, package_template_item_id,
role_catalog_id)` нет активной записи в
`document_package_item_role_assignments`» — нет.

Это **GAP**, не blocker для Sprint 3G (модель/таблица/триггер/индекс на
месте, можно валидировать в Sprint 3H одновременно с generation).

Backlog: `.lovable/backlog/package_validator_role_assignment_missing.md`
(будет создан перед стартом Sprint 3H).

### 7.5 Item-level invariants (DB) — PASS

Из `pg_indexes` по `document_package_item_role_assignments`:

```text
ux_dpira_active_person  UNIQUE  (package_session_id, package_template_item_id,
                                  role_catalog_id, person_id)
                          WHERE  is_active = true AND person_id IS NOT NULL
idx_dpira_session_item   btree  (package_session_id, package_template_item_id)
idx_dpira_role           btree  (role_catalog_id)
idx_dpira_person         btree  (person_id) WHERE person_id IS NOT NULL
```

Из `pg_trigger`:

```text
trg_dpira_assert_package_match  BEFORE INSERT OR UPDATE OF role_catalog_id,
                                package_template_item_id, package_session_id
                                EXECUTE FUNCTION dpira_assert_package_match()
trg_dpira_updated_at            BEFORE UPDATE EXECUTE update_updated_at_column()
```

Следствия:
- Один `person_id` может встречаться на разные `(item_id, role_id)` в одной
  сессии — partial unique включает обе колонки, конфликта нет.
- На одну `(session, item, role)` можно вставить N разных `person_id` —
  unique скоупится по `person_id`.
- Дубликат `(session, item, role, person)` среди active=true блокируется
  индексом.
- Кросс-пакетная привязка (`role_catalog.package_template_id ≠
  package_template_item.package_template_id`) блокируется триггером.

### 7.6 Кнопка «Сформировать пакет» — PASS

`DocumentPackageIdeologyView.tsx:402-435`:

```tsx
<Button size="sm" disabled>
  <Sparkles /> Сформировать пакет
</Button>
<TooltipContent>Генерация пакета подключается в Sprint 2.</TooltipContent>
```

Кнопка `disabled` безусловно. `useAiDocumentPackageGeneration` hook
(`src/hooks/useAiDocumentPackageGeneration.ts`) определён, но
`rg -n "useAiDocumentPackageGeneration" src/` показывает **0 consumers** —
production его не вызывает. Edge function `ai-generate-document-package`
существует в репо, но ни один UI/edge code path её не зовёт в скоупе
Sprint 3G.

Текстовая копия «Sprint 2» — legacy подпись, обновится на «Sprint 3H» в
момент wiring реальной генерации.

Вердикт: **PASS** (генерация не вызывается, Gotenberg не дёргается, в
`ai_generated_documents` ничего не пишется).

### 7.7 Untouched artifacts — PASS

`rg` по Sprint-3G файлам
(`DocumentPackageQuestionnairesView.tsx`,
`useDocumentItemRoleAssignments.ts`, `billingFldGroups.ts`,
`_shared/resolve-package-tokens.ts`):

| Проверка | Команда | Результат |
|---|---|---|
| `canonical-document-generate-strict` не вызывается | `rg canonical-document-generate-strict` | только комментарии-«не трогать» |
| Gotenberg не вызывается | `rg -i gotenberg` | только комментарий-напоминание |
| `ai_generated_documents` не пишется | `rg ai_generated_documents` | только JSDoc-комментарий |
| billing resolver не тронут | `rg "customer_resolver\|executor_resolver\|resolve-billing\|billingResolver"` | 0 совпадений |
| Нет нового пакетного генератора | `rg "generate-package\|package-generate\|document-package-generation\|generateDocumentPackage" src supabase/functions` | 0 совпадений |

### 7.8 Future generation architecture (правило для Sprint 3H)

Sprint 3G НЕ создаёт нового generation engine. На Sprint 3H фиксируется
обязательное правило:

> Пакетная генерация должна переиспользовать существующий pipeline
> генерации документа: DOCX renderer, placeholder parser/resolver chain,
> Gotenberg/PDF conversion, storage path,
> `document_templates.template_version`/`validation_status`,
> `ai_generated_documents` history.

Допустимый новый слой — только package-orchestrator, который:

1. читает `document_package_session` и текущий `package_template_id`;
2. перечисляет `document_package_template_items`;
3. для каждого item собирает контекст:
   - выбранное ЮЛ/ИП/ФЛ пакета;
   - `document_package_item_role_assignments` (active) для пары
     `(session_id, package_template_item_id)`;
   - package resolvers (`{{package.ul|ip|fl.FLD-...}}`, `{{ln-XXXXXX}}`)
     через `_shared/resolve-package-tokens.ts` с
     `packageTemplateItemId = item.id`;
4. вызывает существующую generation/render-функцию для одного шаблона;
5. пишет результат в `ai_generated_documents` тем же путём, что и
   одиночный документ, с дополнительным `meta.package_session_id` /
   `meta.package_template_item_id`.

Любая попытка в Sprint 3H завести параллельную edge-функцию, которая сама
рендерит DOCX/PDF или пишет в storage/`ai_generated_documents` в обход
существующего pipeline, считается **blocker** и должна быть отклонена на
ревью.

Controlled validation (`PackageTemplateValidationPanel`,
`canonical-template-audit`) — НЕ генерация: она имеет право читать DOCX и
проверять плейсхолдеры, но не имеет права вызывать Gotenberg, создавать
PDF, писать в `ai_generated_documents`/storage или менять snapshot.

### 7.9 Closeout

| Пункт | Статус |
|---|---|
| 7.1 PKR catalog UI | PASS (canon token `{{ln-XXXXXX}}`) |
| 7.2 System FLD valid | PASS |
| 7.3 Billing FLD warning | PASS |
| 7.4 `role_assignment_missing` | **GAP → Sprint 3H** |
| 7.5 Item-level DB invariants | PASS |
| 7.6 «Сформировать пакет» disabled | PASS |
| 7.7 Untouched artifacts | PASS |
| 7.8 Future generation rule | RECORDED |

**Sprint 3G — CLOSED** с единственным открытым пунктом 7.4
(`role_assignment_missing` warning), который перенесён в Sprint 3H и не
блокирует архитектурную готовность item-level questionnaires.
