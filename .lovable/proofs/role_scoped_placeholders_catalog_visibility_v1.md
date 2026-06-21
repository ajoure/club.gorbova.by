# PATCH-ROLE-SCOPED-PLACEHOLDERS-CATALOG-VISIBILITY-V1 — PROOF

Status: **PASS** (frontend-only + одноразовый data-update без изменения схемы).

## 1. Контракт

SOT настройки — `public.document_package_role_catalog.metadata` (jsonb, уже существовала, миграция схемы не нужна):

```json
{
  "enable_person_subfields": true
}
```

- `true` → каталог плейсхолдеров показывает 25 sub-field токенов физлица, назначенного на роль.
- отсутствует / `false` → показывается только базовый `{{ln-XXXXXX}}` + одна сервисная подсказка «Расширенные данные физлица скрыты». Никаких 25 sub-field токенов.

Бэкенд-резолверы (`supabase/functions/_shared/resolve-package-tokens.ts`, `canonical-document-generate-strict`, `ai-generate-document-package`) **не трогались**. Они продолжают резолвить `{{ln-XXXXXX.<sub_field>}}` независимо от этой настройки — переключатель управляет только видимостью в каталоге, не валидностью токена.

## 2. Frontend-изменения (5 файлов, без миграции схемы)

| Файл | Изменение |
|------|-----------|
| `src/utils/packagePlaceholderCatalog.ts` | `PackageRoleCatalogRow.metadata` (`Record<string, unknown> \| null`); `buildPackageRoleItems()` гейтит цикл по `LN_SUB_FIELD_SPECS` через `metadata.enable_person_subfields`; при выключенном — одна сервисная карточка (`status: "deferred"`, `package_token: null`, `tech_key: ln.<public_id>.__subfields_hidden_hint__`). При включённом — sub-fields получают префикс группы `ФИО / Паспорт / Адрес / Контакты / Банк` в `label_ru`. |
| `src/components/ai-documents/PlaceholdersCatalogTab.tsx` | В `select(...)` и `map(...)` загрузки `document_package_role_catalog` добавлено поле `metadata`. Рендер не менялся: карточка-подсказка автоматически рендерится без кнопки «Копировать» (поведение существующей ветки `finalToken == null`). |
| `src/hooks/usePackageRoleCatalog.ts` | `UpdatePackageRoleInput.metadata?: Record<string, unknown>`; в `updateMutation` перед `UPDATE` читается текущий `metadata` и делается merge `{...current, ...metadataPatch}` — другие ключи не теряются. |
| `src/components/ai-documents/packages/PackageRolesManager.tsx` | В `EditRoleDialog` добавлен блок «Расширенные данные физлица» с `Switch`, сохраняющим `metadata: { enable_person_subfields: <bool> }` (через merge). В строке роли (`renderRow`) — компактный бейдж `IdCard «реквизиты ФЛ»` с tooltip, когда настройка включена. |

## 3. Data-update (одноразово, через migration-канал — без изменения схемы)

```sql
UPDATE public.document_package_role_catalog
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('enable_person_subfields', true)
 WHERE id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb'
   AND label = 'Участник'
   AND package_template_id = '21764469-1ba9-49b3-90d9-5349bcbcd531';
```

Контроль (через `supabase--read_query`, после применения):

```text
public_id   | label         | metadata
------------+---------------+------------------------------------------
ln-000016   | Председатель  | {}
ln-000014   | Ревизор       | {}
ln-000017   | Секретарь     | {}
ln-000015   | Участник      | {"enable_person_subfields": true}
```

- «Участник» — включено как явно требовалось.
- «Ревизор / Секретарь / Председатель» — `metadata = {}`, расширенные данные **скрыты по умолчанию**.

## 4. Поведение каталога (две точки входа — единый код)

`PlaceholdersCatalogTab` рендерится в двух местах и использует один и тот же `buildPackageRoleItems`:

- верхняя вкладка `Документы → Плейсхолдеры` (`AiPageContent.tsx`, `sub=placeholders`);
- вкладка внутри пакета `Документы → Пакеты → <Пакет> → Плейсхолдеры` (`PackagesWorkspace.tsx`, `pkgTab=placeholders`).

Поведение идентично в обеих вкладках.

### Роль «Участник» (`ln-000015`, enable_person_subfields=true)

В группе «Пакет: Роли» видны:

- `{{ln-000015}}` — базовый токен (всегда).
- 25 sub-field токенов с префиксом группы в названии, например:
  - `Участник · ФИО · ФИО (полное)` → `{{ln-000015.full_name}}`
  - `Участник · Паспорт · Паспорт: серия и номер` → `{{ln-000015.passport_number_full}}`
  - `Участник · Паспорт · Дата рождения` → `{{ln-000015.birth_date}}`
  - `Участник · Паспорт · Личный номер` → `{{ln-000015.personal_number}}`
  - `Участник · Адрес · Адрес (полный)` → `{{ln-000015.address_full}}`
  - `Участник · Адрес · Адрес: город` → `{{ln-000015.address_city}}`
  - `Участник · Контакты · Телефон` → `{{ln-000015.phone}}`
  - `Участник · Банк · Банк: счёт` → `{{ln-000015.bank_account}}`

### Роль «Ревизор» (`ln-000014`, по умолчанию)

В группе «Пакет: Роли» видны ровно 2 строки:

1. `{{ln-000014}}` — базовый токен (статус «готов», кнопка «Копировать»).
2. Сервисная подсказка «Ревизор — расширенные данные физлица скрыты» (статус «Sprint 3E», **без** кнопки «Копировать» и без токена). В `package_resolver_hint` подсказка инструктирует включить переключатель в редактировании роли.

Аналогично для «Секретарь» (`ln-000017`) и «Председатель» (`ln-000016`).

## 5. Resolver не сломан

`{{ln-000014.passport_number_full}}` (вручную вставленный в DOCX токен для роли Ревизор, у которой переключатель **выключен**) продолжает резолвиться:

- Sprint-3J/3K spec `LN_SUB_RE = /^ln-\d{6}(\.[a-z_]+)?(\|...)?$/` парсит токен в `canonical-document-generate-strict` и в `ai-generate-document-package` независимо от каталога ролей.
- `resolveLnSubFieldToken()` в `supabase/functions/_shared/resolve-package-tokens.ts` валидирует `sub_field` против whitelist `LN_SUB_FIELD_SPECS`, читает `legal_details_persons.passport_number_full` через `document_package_item_role_assignments`, применяет multi-policy.
- Файлы резолверов в этом патче **не редактировались** — поведение гарантировано контрактом «catalog visibility ≠ resolver validity».

## 6. Поиск каталога не вытаскивает скрытые поля

Search-фильтр в `PlaceholdersCatalogTab` (стр. 449–457) матчится по `label_ru`, `tech_key`, `reused_fld`, `billing_fld_analog`, `package_token`. В скрытом состоянии:

- 25 sub-field item'ов вообще не создаются → ни `passport_number_full`, ни `birth_date`, ни `address_full` не находятся для роли с выключенным переключателем.
- Сервисная подсказка имеет `label_ru = "<роль> — расширенные данные физлица скрыты"` — без слов «паспорт», «адрес», «телефон», «банк». Поиск по этим словам не вытаскивает её.
- Полный пояснительный текст для подсказки лежит в `package_resolver_hint`, который в поиске не участвует.

## 7. Счётчик «Всего плейсхолдеров»

`rows.length` (стр. 538) считает только биллинговый блок (`PLACEHOLDER_DEFINITIONS`), а не пакетные группы. Сервисные подсказки в пакетных группах не попадают в этот счётчик.

## 8. Merge metadata без потери ключей

`usePackageRoleCatalog.updateMutation` (новый код) перед `UPDATE` делает `select metadata where id=…`, затем сливает `{...currentObj, ...metadataPatch}` и шлёт в `UPDATE`. Поэтому будущие ключи `metadata.*` (если такие появятся) не затираются при включении/выключении переключателя.

## 9. Cache / refresh

- `EditRoleDialog` сохраняет → `usePackageRoleCatalog` инвалидирует ключ `["package-role-catalog", packageTemplateId]` → строка роли в `PackageRolesManager` мгновенно получает бейдж «реквизиты ФЛ».
- В `PlaceholdersCatalogTab` загрузка ролей идёт прямо из `supabase` в `useEffect` без кэша react-query, поэтому полный refresh (F5) гарантирует свежие данные. После F5 настройка читается из БД и применяется идентично.

## 10. DoD (повторно подтверждено)

1. Каталог больше **не показывает 25 расширенных sub-fields** для каждой роли подряд.
2. У каждой роли в `EditRoleDialog` есть редактируемая настройка «Расширенные данные физлица».
3. По умолчанию расширенные данные скрыты (`metadata.enable_person_subfields` отсутствует → `false`).
4. Для выбранной роли можно включить расширенные данные — после сохранения каталог сразу показывает 25 токенов с группировкой ФИО / Паспорт / Адрес / Контакты / Банк.
5. Базовый `{{ln-XXXXXX}}` всегда виден.
6. Resolver не сломан, продолжает поддерживать `{{ln-XXXXXX.<sub_field>}}` независимо от настройки каталога.
7. БД-схема / RPC / edge / cron — не менялись. Был только один data-update на запись `ln-000015` (роль «Участник» в пакете «Годовое собрание участников»).
8. Верхний каталог и каталог внутри пакета ведут себя идентично — один компонент `PlaceholdersCatalogTab`, один `buildPackageRoleItems`.

## 11. Не сломано (регрессий нет)

- `PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1` остаётся PASS: контракт `{{ln-XXXXXX.<sub_field>}}` цел, sub-field whitelist и resolver не тронуты.
- `packagePlaceholderCatalog.test.ts` обновлён: добавлен новый сценарий «по умолчанию sub-fields скрыты + одна подсказка», старый сценарий явно проставляет `metadata: { enable_person_subfields: true }`.

## Финал

**PATCH-ROLE-SCOPED-PLACEHOLDERS-CATALOG-VISIBILITY-V1 — PASS.**
