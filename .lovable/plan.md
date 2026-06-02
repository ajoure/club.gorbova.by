да, согласен, с учетом правок:

1. **План корректный по сути**
  - Причина найдена правильно: `/document-generation` гейтится через `get_user_section_access`, а новый `grant_target_type='document_generation'` туда не подключен.
  - Исправлять нужно мостом в section-access resolver, а не созданием дублей `section_access`.
2. **Уточнить, что** `document_generation`**-правило открывает только видимость секции**
  - На уровне `get_user_section_access`:
    - `document_generation/full` = секция доступна;
    - `document_generation/partial` = секция доступна;
  - Фильтрация конкретных пакетов остается внутри `get_user_document_package_ids()` / RLS пакетов.
  - Нельзя на уровне секции пытаться читать `allowed_package_ids`.
3. **Не использовать** `target_ref::uuid` **в ветке** `document_generation`
  - Для нового типа `document_generation` `target_ref='document_generation'` — sentinel string.
  - Ветка должна джойниться к `app_sections` только по `s.code='document_generation'`.
  - Это важно, чтобы не получить cast error.
4. **Добавить защиту от дублей в** `UNION ALL`
  - Если у пользователя есть одновременно:
    - legacy `section_access → section uuid`;
    - новое `document_generation`;
  - результат `get_user_section_access` не должен дублировать одну секцию.
  - Итоговый SELECT должен агрегировать по section id/code или использовать `EXISTS`.
5. **AdminSections rules_count считать как сумму, но без двойного счёта**
  - Если есть и `section_access` на UUID секции, и `document_generation`, счётчик может показывать 2 — это допустимо, если это реально 2 правила.
  - Но сама секция в списке не должна дублироваться.
  - Фильтр «С правилами» должен смотреть `rules_count > 0`.
6. **Dry-run расширить на partial/full**
  - Проверить не только текущий partial rule `90f6fd03…`, но и:
    - `document_generation/full`;
    - `document_generation/partial`;
    - legacy `section_access → section uuid`;
    - пользователь без правил.
7. **Добавить proof, что пакеты по-прежнему фильтруются**
  - После открытия секции у Наиры проверить не только, что `/document-generation` открылась, но и что внутри виден только разрешенный пакет.
  - Иначе можно случайно открыть секцию, но потерять гранулярность внутри.
8. **Не менять контракт** `grant-access-for-order`
  - Если сейчас заказы уже создают `document_generation`-правило — не трогать.
  - Если не создают — это отдельный follow-up, не в этом плане.

Копируемый блок:

```text
План согласован, с уточнениями.

1. В `get_user_section_access` добавить мост для `grant_target_type='document_generation'` только для секции `app_sections.code='document_generation'`.

Это правило должно влиять только на видимость раздела `/document-generation`.

Семантика:
- `document_generation/full` → секция доступна;
- `document_generation/partial` → секция доступна;
- фильтрация конкретных пакетов остается внутри `get_user_document_package_ids()` / RLS пакетов.

На уровне section-access resolver не читать и не применять `allowed_package_ids`.

2. В ветке `document_generation` не делать `target_ref::uuid`.

Для `grant_target_type='document_generation'` поле `target_ref='document_generation'` является sentinel string.

Джойн к секции делать только через:
- `app_sections.code = 'document_generation'`.

3. Сохранить legacy.

Старый путь:
- `grant_target_type='section_access'`;
- `target_ref=<uuid секции>`.

должен продолжать работать как раньше.

Не создавать дублирующие `section_access`-правила и не переписывать существующее правило `90f6fd03…`.

4. Защититься от дублей в результате RPC.

Если у пользователя есть одновременно:
- legacy `section_access` на UUID секции;
- новое `document_generation`-правило;

`get_user_section_access` не должен возвращать одну и ту же секцию двумя строками.

Использовать агрегацию/EXISTS/группировку по section id/code.

5. В `/admin/sections` rules_count для «Генерация документов» учитывать оба типа правил:

- `section_access` на UUID секции;
- `document_generation` с `target_ref='document_generation'`.

Счётчик может показывать 2, если реально есть 2 правила. Но секция в списке не должна дублироваться.

6. Расширить dry-run / verify.

Проверить:
- текущий partial rule `document_generation` с `allowed_package_ids=[Идеология]` открывает секцию;
- `document_generation/full` открывает секцию;
- legacy `section_access → section uuid` открывает секцию;
- пользователь без правил не получает доступ;
- другие секции не изменили поведение.

7. Добавить proof гранулярности внутри страницы.

После того как у Наиры откроется `/document-generation`, проверить:
- секция доступна;
- внутри виден только разрешенный пакет;
- остальные пакеты не видны при partial-доступе.

8. Не трогать:
- `grant-access-for-order`;
- entitlement-sync;
- training-content;
- resolver пакетов;
- RLS пакетов;
- audit;
- генерацию документов;
- sessions;
- Gotenberg;
- edge functions.

9. DoD дополнить:

- `/document-generation` доступен клиентам ИДЕОЛОГИИ;
- при partial-доступе внутри страницы видны только разрешенные UUID-пакеты;
- `/admin/sections` показывает корректный rules_count;
- пользователь без доступа не получает секцию;
- legacy section_access продолжает работать;
- build зелёный;
- proof-файл приложен.

План: фикс доступа к разделу «Генерация документов» и счётчика правил
```

## Diagnose (что нашли)

1. RPC `public.get_user_section_access` резолвит доступ к секции ТОЛЬКО по `access_rules.grant_target_type='section_access'` и сравнению `target_ref::uuid = app_sections.id`. Новый тип `grant_target_type='document_generation'` (sentinel `target_ref='document_generation'`) этой функцией не учитывается.
2. В БД для продукта `11c9f1b8…` тариф ИДЕОЛОГИЯ (`b018e9be…`) есть ровно 1 активное правило домена документов: rule `90f6fd03…`, `grant_target_type='document_generation'`, `target_ref='document_generation'`, partial, `allowed_package_ids=[Идеология]`. Соответствующего `section_access`-правила с `target_ref=<uuid секции /document-generation>` нет.
3. Поэтому:
  - у Наиры (и у всех клиентов ИДЕОЛОГИИ — сейчас 2 активных подписки) `/document-generation` остаётся закрытым;
  - страница `/admin/sections` считает правила по тому же фильтру (`grant_target_type='section_access' AND target_ref=section.id`) → колонка «Правил» для «Генерация документов» = 0, статус «закрытый».
4. Контракт раздела уже выбран как канонический: domain-rule с `grant_target_type='document_generation'` + sentinel `target_ref='document_generation'`. Менять контракт нельзя — нужно только подключить его к section-access резолверу и к админ-счётчику. Legacy `section_access → target_ref='document_generation'` мы не используем (там UUID секции), но оставим работать как есть.

## Scope

Только видимость секции `/document-generation` и UI-счётчик правил. Не трогаем: контент-резолвер пакетов, генерацию документов, `grant-access-for-order`, entitlement-sync, training-content, RLS, audit, edge functions.

## Изменения

### 1. Migration: расширить `get_user_section_access`

Добавить во входной CTE-резолвер второй источник правил ТОЛЬКО для секции `code='document_generation'`:

- `access_rules ar WHERE ar.is_active AND ar.grant_target_type='document_generation' AND ar.target_ref='document_generation'`
- джойн к секции по `s.code='document_generation'` (а не по target_ref);
- та же логика match, что и для section_access:
  - если `rule_tariff_id` — match по `user_subs.tariff_id`;
  - иначе если `rule_product_id` — match по `user_subs.product_id` или `user_ents.product_id`.
- partial/full и `allowed_package_ids` на уровне видимости секции игнорируются — оба варианта = «секция доступна» (партиал-фильтр пакетов уже применяется внутри страницы при работе с пакетами).
- Inactive section и admin-bypass работают как раньше.
- Legacy `grant_target_type='section_access' AND target_ref=<uuid секции document_generation>` продолжает работать (вторая ветка UNION).

Реализация: внутри CTE `section_rules` сделать `UNION ALL` второй ветки правил (или эквивалентный `LEFT JOIN LATERAL`), не меняя ничего для остальных секций. Возвращаемый TYPE и сигнатуру RPC не меняем.

### 2. UI: `src/pages/admin/AdminSections.tsx`

В `queryFn` для `admin-sections`:

- параллельно с текущим запросом `section_access`-правил подгрузить правила `grant_target_type='document_generation' AND is_active=true AND target_ref='document_generation'`;
- к `countMap[<id секции document_generation>]` прибавить их количество;
- ничего больше не менять (фильтры, deactivate-guard, UI).

Дополнительно: счётчик `rules_count` теперь корректно отражает реальные правила домена, поэтому подсветка «закрытый» + «с правилами» начнёт работать сама.

### 3. Никаких миграций контракта правил

Мы НЕ создаём дублирующих `section_access` правил для секции document_generation, НЕ переписываем существующее правило `90f6fd03…`, НЕ меняем `target_ref`. Источник истины остаётся domain-rule `document_generation/document_generation`.

## Dry-run (симуляция доступов)

Перед миграцией прогнать (read-only):

```sql
-- 1. Все активные подписки ИДЕОЛОГИИ (b018e9be) — кто получит доступ
SELECT s.user_id, p.email
FROM subscriptions_v2 s
JOIN profiles p ON p.user_id = s.user_id
WHERE s.tariff_id='b018e9be-53ce-4840-8034-e09f8e319080'
  AND s.status IN ('active','trial');

-- 2. Текущий результат resolver для секции document_generation у этих юзеров
SELECT user_id,
       (SELECT has_access FROM get_user_section_access(user_id)
        WHERE section_code='document_generation') AS before_fix
FROM (…тот же список…) u;
```

Ожидаем: `before_fix = false` для обоих → после миграции должно стать `true`.

## Execute

`supabase--migration` с `CREATE OR REPLACE FUNCTION public.get_user_section_access` (полное тело со второй веткой правил). Один файл миграции, без других изменений схемы. Затем правка `AdminSections.tsx`.

## Verify

1. SQL: повторить dry-run-запрос → `has_access = true` для обоих клиентов ИДЕОЛОГИИ.
2. SQL: для любого юзера БЕЗ ИДЕОЛОГИИ/без активных подписок секция document_generation остаётся `has_access = false` (регрессия default-deny).
3. Build `tsc --noEmit` зелёный.
4. UI чек на `/admin/sections`: у «Генерация документов» в колонке «Правил» появляется `1`, фильтр «С правилами» включает её.
5. UI чек на `/document-generation` от лица Наиры (через Login as Developer, пароль `123456`): замок снят, страница открыта.
6. Proof-файл `.lovable/proofs/document_generation_section_access_bridge.md` с SQL до/после и списком user_id когорты.

## DoD

- Клиенты с активной подпиской по тарифу ИДЕОЛОГИЯ видят `/document-generation` без замка;
- legacy `section_access → <section uuid>` для document_generation продолжает работать (если когда-либо создан);
- `/admin/sections` показывает корректный `rules_count` для document_generation;
- ни одна другая секция не меняет поведения;
- ни один user без правил не получает доступ (default-deny сохранён);
- build зелёный, proof приложен.