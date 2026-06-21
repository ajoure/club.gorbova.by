# да, согласен, с учетом правок:

1. **План можно выполнять как frontend-only**, потому что `metadata jsonb` уже есть в `document_package_role_catalog`, а resolver не должен зависеть от видимости в каталоге.
2. **Не добавлять новый статус** `hidden_subfields`**, если типы каталога этого не поддерживают.**  
Лучше использовать существующий безопасный вариант:
  &nbsp;
  ```text
  status: "draft"
  copyable: false
  is_service_hint: true
  ```
  или аналогичный существующий механизм. Цель — не ломать типы и сортировку каталога ради одной подсказки.
3. **Сервисная запись “Расширенные данные скрыты” не должна считаться плейсхолдером.**
  &nbsp;
  Для неё:
  - нет кнопки «Скопировать»;
  - нет токена;
  - не попадает в счётчик «Всего плейсхолдеров» как полноценный placeholder;
  - не должна находиться поиском по `passport_number_full`, если расширенные поля скрыты.
4. **Поиск в каталоге должен уважать настройку.**
  &nbsp;
  Если у роли `enable_person_subfields=false`, то поиск по:
  ```text
  passport
  birth_date
  address_full
  личный номер
  ```
  не должен вытаскивать скрытые sub-fields этой роли.
5. **Фильтр “Пакет: Роли” не должен превращаться в мусор.**
  &nbsp;
  В DoD добавить количественную проверку:
  - до включения: роль показывает базовый блок + одну подсказку;
  - после включения: роль показывает базовый блок + расширенные sub-fields;
  - для остальных ролей расширенные sub-fields не выводятся.
6. **В** `metadata` **делать merge строго без потери других ключей.**
  &nbsp;
  Если используете update через hook, нужно сначала иметь актуальный `metadata`, затем писать:
  ```ts
  metadata: {
    ...currentMetadata,
    enable_person_subfields: enableSubfields
  }
  ```
  Не отправлять `metadata: { enable_person_subfields: true }`, если это может затереть остальные ключи.
7. **При выключении переключателя не удалять токены из шаблонов и не ломать генерацию.**
  &nbsp;
  Это правильно указано в плане. В proof обязательно показать:
8. **Одноразовый SQL-апдейт по роли “Участник” допустим, но proof должен содержать** `RETURNING`**.**
  &nbsp;
  SQL лучше оформить так:
  ```sql
  UPDATE public.document_package_role_catalog
     SET metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('enable_person_subfields', true)
   WHERE label = 'Участник'
     AND package_template_id = '21764469-1ba9-49b3-90d9-5349bcbcd531'
  RETURNING id, label, public_id, metadata;
  ```
  Лучше использовать точный `package_template_id`, а не `name ilike`, чтобы не включить не тот пакет.
9. **Для роли “Ревизор” специально ничего не включать.**
  &nbsp;
  В proof показать, что:
10. **В строке роли бейдж должен быть коротким и не засорять UI.**

Например:

```text
реквизиты ФЛ
```

или иконка с tooltip. Не нужно длинный текст прямо в списке ролей.

11. **Группировка sub-fields внутри расширенного блока — полезно, но не блокер.**

Минимальный PASS:

- скрытие/показ работает;
- sub-fields не выводятся для выключенных ролей;
- включённые роли показывают все 25 полей.

Группы `ФИО / Паспорт / Адрес / Контакты / Банк` можно делать в этом же патче, но если начнёт усложнять UI — не задерживать основной фикс.

12. **Проверить оба каталога.**

Обязательные проверки:

- верхняя вкладка `Документы → Плейсхолдеры`;
- вкладка `Плейсхолдеры` внутри пакета;
- поведение идентично, потому что используется один `PlaceholdersCatalogTab`.

13. **DoD дополнить проверкой refresh/cache.**

После включения переключателя у роли:

- открыть каталог;
- увидеть sub-fields;
- F5;
- sub-fields остаются видимыми;
- выключить переключатель;
- F5;
- sub-fields скрыты.

14. **Не менять backend, strict generator и token resolver.**

Если во время реализации потребуется правка edge/strict/resolver — STOP, это уже не catalog visibility patch.

15. **Итоговый статус после выполнения:**

```text
PATCH-ROLE-SCOPED-PLACEHOLDERS-CATALOG-VISIBILITY-V1 — PASS
```

А `PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1` остаётся PASS, без отката.

После этих правок план можно выполнять.

&nbsp;

План: PATCH-ROLE-SCOPED-PLACEHOLDERS-CATALOG-VISIBILITY-V1

## Discovery (выполнено)

- В таблице `public.document_package_role_catalog` уже есть колонка `metadata jsonb` (подтверждено через information_schema). **Миграция не нужна.**
- Все 25 sub-field токенов на роль эмитируются ровно в одной точке: `src/utils/packagePlaceholderCatalog.ts` → `buildPackageRoleItems()` (стр. 616–664), цикл `for (const spec of _LN_SUB)`.
- Каталог ролей в UI загружается в `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (стр. 304–337) — один запрос к `document_package_role_catalog`, мапится в `PackageRoleCatalogRow`. Этот же `buildPackageRoleItems()` используется и в верхней вкладке «Документы → Плейсхолдеры», и в скопированной вкладке внутри пакета (см. `PackagesWorkspace.tsx` `value="placeholders"`).
- Backend-резолверы (`supabase/functions/_shared/resolve-package-tokens.ts`, `canonical-document-generate-strict`, `ai-generate-document-package`) принимают `ln-XXXXXX.<sub_field>` независимо от метаданных каталога — их **не трогаем**.

Вывод: патч полностью frontend-only, без миграций, без edge-функций, без RPC.

## Контракт хранения

Семантика на роли:

```json
metadata: {
  "enable_person_subfields": true | false
}
```

- Чтение: `Boolean(metadata?.enable_person_subfields) === true` → показывать.
- Дефолт для всех существующих ролей: значение отсутствует → трактуется как `false`.
- Любые другие ключи в `metadata` оставляем нетронутыми (merge-update).

## Изменения

### 1. `src/utils/packagePlaceholderCatalog.ts`

- В `PackageRoleCatalogRow` добавить `metadata: Record<string, unknown> | null`.
- В `buildPackageRoleItems()`:
  - Базовый токен `{{ln-XXXXXX}}` — всегда (как сейчас).
  - Цикл по `_LN_SUB` оборачиваем условием `Boolean((r.metadata as any)?.enable_person_subfields) === true`.
  - Если выключено — вместо 25 токенов добавляем **одну** сервисную запись (`status: "draft"` или новый `status: "hidden_subfields"`) с подсказкой:
    > «Расширенные данные физлица скрыты для этой роли. Включите их в настройках роли, если нужны паспортные данные, адрес, дата рождения и другие реквизиты.»
  - Подгруппы внутри расширенного блока (ФИО / Паспорт / Адрес / Контакты / Банк) — выводим через мягкий префикс в `label_ru` на основе ключа из `LN_SUB_FIELD_SPECS` (без новой схемы; группа выводится из `spec.key`). Если в текущем `LN_SUB_FIELD_SPECS` нет поля `group`, добавляем локальный маппинг `keyToGroup(spec.key)` внутри этого же файла — без правки spec'а.

### 2. `src/components/ai-documents/PlaceholdersCatalogTab.tsx`

- В `select(...)` запроса каталога ролей (стр. 310–314) добавить `metadata`.
- В мапинг в `PackageRoleCatalogRow` (стр. 322–333) пробросить `metadata: r.metadata ?? null`.
- Рендер: для записи-плейсхолдера «скрыто» отрисовать неактивную карточку-подсказку с текстом из п. 1 (без кнопки «Скопировать»). Базовая карточка `{{ln-XXXXXX}}` остаётся активной.

### 3. `src/hooks/usePackageRoleCatalog.ts`

- В `PackageRoleRow` — поле уже есть (`metadata: Record<string, unknown>`).
- В `UpdatePackageRoleInput` добавить опциональное `metadata?: Record<string, unknown>`.
- В `updateMutation` обеспечить merge: читать текущий `metadata` из кэша/строки и слать `{ ...current, ...patch.metadata }`, чтобы не затереть будущие ключи. Если merge сложно — отдельный хелпер `setRoleMetadataKey(id, key, value)`.

### 4. `src/components/ai-documents/packages/PackageRolesManager.tsx`

- В `EditRoleDialog`:
  - Добавить блок «Расширенные данные физлица» с `Switch` + Label:
    > **Показывать паспортные, адресные и личные данные** в каталоге плейсхолдеров для этой роли.
  - Состояние `enableSubfields` инициализировать из `row.metadata?.enable_person_subfields`.
  - В `onSave` передавать `metadata: { enable_person_subfields: enableSubfields }` (merge выполняет хук).
- Тип `onSave` расширить полем `metadata?: Record<string, unknown>`; в `PackageRolesManager` пробросить в `update(...)`.
- В строке роли (список) показывать маленький бейдж/иконку, когда `enable_person_subfields=true`, чтобы видеть включённые роли без открытия диалога.

### 5. Точечное действие данных (выполняется уже в build-режиме отдельным SQL-апдейтом, не миграцией)

Для пакета «Годовое собрание участников» включить переключатель у роли «Участник»:

```sql
update public.document_package_role_catalog
   set metadata = coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object('enable_person_subfields', true)
 where label = 'Участник'
   and package_template_id = (
     select id from public.document_package_templates
      where name ilike '%Годовое собрание участников%'
      limit 1
   );
```

Для «Ревизор», «Секретарь», «Председатель» — ничего не делаем (дефолт = выключено).

## Что НЕ меняется

- `supabase/functions/_shared/resolve-package-tokens.ts`
- `supabase/functions/canonical-document-generate-strict/index.ts`
- `supabase/functions/ai-generate-document-package/index.ts`
- `src/lib/documents/lnSubFieldSpec.ts` и `supabase/functions/_shared/ln-subfield-spec.ts`
- Любая БД-схема, RLS, RPC, cron, edge.

Это гарантирует, что вручную вставленный в DOCX токен `{{ln-000015.passport_number_full}}` продолжает резолвиться даже после выключения переключателя.

## DoD

1. В каталоге плейсхолдеров (верхняя вкладка и копия в пакете) для роли с `enable_person_subfields != true` отображается только базовый `{{ln-XXXXXX}}` + одна подсказка «Расширенные данные скрыты». 25 sub-field токенов не выводятся.
2. В `EditRoleDialog` есть переключатель «Расширенные данные физлица»; изменение сохраняется в `metadata.enable_person_subfields`, прочие ключи `metadata` не теряются.
3. После включения переключателя у роли — в каталоге появляются все sub-field токены, сгруппированные по ФИО / Паспорт / Адрес / Контакты / Банк.
4. Для пакета «Годовое собрание участников» роль «Участник» имеет переключатель включённым (одноразовый SQL-апдейт без миграции).
5. Резолверы продолжают принимать `{{ln-XXXXXX.<sub_field>}}` независимо от настройки каталога (ручная проверка: рендер шаблона с таким токеном проходит).
6. Верхний каталог и каталог внутри пакета ведут себя идентично (используют один `buildPackageRoleItems`).
7. Без миграций, без правок edge-функций, без новой таблицы.

## Proof

Файл: `.lovable/proofs/role_scoped_placeholders_catalog_visibility_v1.md`

Содержание:

- скрин/описание роли «Участник» с включённым переключателем + список расширенных токенов в каталоге (`passport_number_full`, `birth_date`, `address_full`, …);
- роль «Ревизор» с выключенным переключателем + подтверждение, что виден только `{{ln-XXXXXX}}` + подсказка «Расширенные данные скрыты»;
- лог запроса к Edge функции strict-generate с токеном `{{ln-000014.passport_number_full}}` для Ревизора → успешный резолв (доказательство, что resolver не зависит от каталога);
- скрин верхнего «Документы → Плейсхолдеры» и вкладки «Плейсхолдеры» внутри пакета для одной и той же роли → идентичный вывод;
- SQL-команда из п. 5 с `returning id, label, metadata`.