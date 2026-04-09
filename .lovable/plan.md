Да, согласен, с учетом правок:

&nbsp;

1. В dry-run добавь **обязательную проверку блока completed/finished** для Демко Людмилы.
  На скрине видно Показать завершённые (3), значит сначала нужно доказать не только “нет в active”, но и:
  &nbsp;
  - запись ушла в completed,
  - запись отсутствует совсем,
  - запись есть в raw data, но режется predicate’ом.
  &nbsp;
2. В backend-proof по родительскому курсу проверь **обе сущности отдельно**:
  &nbsp;
  - subscriptions_v2 по родительскому product_id
  - entitlements по родительскому product_id
    И для каждой явно вывести verdict:
  - проходит active-predicate,
  - проходит completed-predicate,
  - режется productsWithRules,
  - отсутствует.
  &nbsp;
3. В PATCH B зафиксируй жёстко:
  **если root cause = productsWithRules / отсутствует active rule для parent product, сначала исправляется SoT/config или read-model, а не делается маскирующий UI-патч.**
  Нельзя просто “показать курс”, если predicate считает его нелегальным.
4. В execute-ветке добавь **строгое разделение**:
  &nbsp;
  - missing_access / expired_access → только canonical access path
  - active_but_hidden_by_ui
  - active_but_filtered_by_productsWithRules
  - present_in_completed_only
    Это должен быть явный финальный verdict перед любыми изменениями.
  &nbsp;
5. Для canonical repair укажи, **какой именно путь считается каноническим** для родительского курса:
  &nbsp;
  - grant-access-for-order
  - или rules-retroapply
    Нужен один выбранный write-path, без расплывчатого “rule engine / canonical repair path”.
  &nbsp;
6. Добавь в DoD отдельный proof:
  &nbsp;
  - у Демко Людмилы родительский курс виден **именно в active**, а не в completed,
  - после фикса Показать завершённые (3) не содержит этот курс как скрытый ложный completed-case.
  &nbsp;
7. Пункт про src/components/user/UserSubscriptions.tsx перенеси в **follow-up / parity proof**, а не в основной scope текущего патча, если пока не доказано расхождение.
  Сейчас основная задача — закрыть кейс Демко Людмилы в admin-proof, не раздувая scope.
8. В DoD добавь **SQL-proof block по parent-course access**:
  &nbsp;
  - product_id родителя
  - тип записи: subscription / entitlement
  - status
  - expires_at
  - source_rule_id
  - source_type
  - included_in_active_list = true
  &nbsp;

&nbsp;

&nbsp;

В остальном план стал нормальным: он уже не уходит в display-layer и правильно отделяет факт доступа от рендера.

&nbsp;

План:

1. Проблема

По скрину Демко Людмилы подтверждён дефект: во вкладке «Доступы» среди активных карточек отсутствует родительский курс «Ценный бухгалтер | 1 ступень 2.0», хотя одновременно видны BUSINESS, два модуля и «Деньги BY 1 тариф». Это уже не проблема display-layer сделок, а проблема факта доступа или его рендера.

2. Диагностика

Что уже подтверждено по коду:

- Вкладка «Доступы» в `src/components/admin/ContactDetailSheet.tsx` строится из двух списков:
  - `activeSubscriptions`
  - `activeEntitlements`
- И subscriptions, и entitlements проходят жёсткий фильтр через `productsWithRules` из `useActiveAccessRuleProducts()` (`src/hooks/useAccessValidation.ts`).
- Активный entitlement скрывается, если:
  - `status !== active`
  - `expires_at < now()`
  - продукт деактивирован
  - для `product_id` нет активного `access_rule`
- Активная subscription скрывается, если:
  - статус не `active|trial`
  - срок истёк
  - для `product_id` нет активного `access_rule`
- UI не содержит явной логики “схлопнуть курс, если есть модули”; значит более вероятны два корня:
  1. entitlement/subscription на родительский курс реально не проходит predicate;
  2. запись уходит в completed из-за `productsWithRules` / status / expires_at.

Важно:

- Сейчас план нельзя закрывать blind fix’ом.
- Нужен backend-proof по родительскому `product_id` курса, а затем уже repair или UI-патч.

3. Предлагаемое решение

PATCH A — backend-proof по родительскому курсу Демко Людмилы

- Проверить в БД все записи по родительскому продукту курса `7101ed3c-7839-4a74-ad95-aa0660369b22`:
  - `subscriptions_v2`
  - `entitlements`
  - связанные `access_rules`
- Зафиксировать:
  - есть ли active entitlement;
  - есть ли active subscription;
  - какой `expires_at`;
  - `source_rule_id`, `source_type`, `business_subscription_id`;
  - проходит ли запись текущий predicate UI.

PATCH B — root cause по вкладке «Доступы»
Если родительский доступ есть в БД, но не показывается:

- чинить только read-path вкладки «Доступы»;
- проверить, не режется ли курс из-за условия `productsWithRules.has(product_id)`;
- проверить, не считается ли курс historical только потому, что для него нет активного product-level rule, хотя основание легально;
- при необходимости вынести фильтрацию вкладки «Доступы» на единый effective-access/fact-view, а не на локальный predicate “только продукты с активным rule product_id”.

Если родительского доступа нет или он expired:

- восстановить его только канонически через BUSINESS/access_rules path;
- без ручной вставки в `entitlements`;
- через существующий write-path (rule engine / canonical repair path), с audit/ledger proof.

PATCH C — browser-proof после фикса
Проверить карточку Демко Людмилы повторно:
в активных должны одновременно отображаться:

- Gorbova Club / BUSINESS
- Ценный бухгалтер | 1 ступень 2.0
- Модуль: Розничная торговля
- Модуль: Производство
- Деньги BY 1 тариф

4. Изменяемые компоненты

Обязательная проверка:

- `src/components/admin/ContactDetailSheet.tsx`
- `src/hooks/useAccessValidation.ts`
- активные `access_rules` для родительского продукта курса
- записи в `subscriptions_v2`
- записи в `entitlements`
- при необходимости canonical backend path:
  - `grant-access-for-order`
  - `rules-retroapply`

Если root cause окажется в UI:

- `src/components/user/UserSubscriptions.tsx` тоже нужно привести к той же логике, чтобы не было расхождения admin/user.

5. Что не будет изменено

- Логика отображения модульных сделок по названиям в этом PATCH не является основной целью.
- `orders_v2.product_id` исторических сделок массово не переписывается.
- Legacy-коды (`cb20`, `product_code`) не используются как новая основа логики.
- Не смешивать Демко Людмилу с другими клиентами.
- Не запускать cohort-операции.

6. Dry-run

Сначала только безопасная проверка без мутаций:

- SQL-read по Демко Людмиле:
  - entitlement на родительский курс
  - subscription на родительский курс
  - активные access_rules для родительского курса
- Сопоставление с predicate вкладки «Доступы»:
  - почему запись попадает или не попадает в active list
  - уходит ли она в finished list
  - отсутствует ли полностью

Отдельно dry-run verdict:

- Case 1: `missing_access`
- Case 2: `expired_access`
- Case 3: `active_but_hidden_by_ui`
- Case 4: `active_but_filtered_by_productsWithRules`

7. Execute

Выполнять только после dry-run verdict:

Ветка 1 — если доступ отсутствует / expired:

- восстановить родительский курс канонически через BUSINESS/access_rules path;
- сразу после execute сделать SQL-proof;
- затем browser-proof.

Ветка 2 — если доступ активен, но не рендерится:

- править только UI/read-path:
  - не прятать родительский курс при наличии модулей;
  - курс и модули должны отображаться одновременно.
- затем browser-proof.

8. STOP-guards

- Не делать ручной INSERT entitlement.
- Не изменять данные других пользователей.
- Не трогать модульные entitlements Людмилы, если они уже корректны.
- Не строить решение на `product_code`, `cb20`, названиях или slug.
- Если dry-run покажет, что root cause в отсутствии active rule для product_id родителя, сначала отдельно зафиксировать это как конфигурационный дефект SoT, а не маскировать UI-патчем.
- Не считать задачу закрытой без backend-proof и browser-proof.

9. DoD

Задача считается выполненной только если:

- для Демко Людмилы backend-proof показывает корректное основание доступа к родительскому курсу;
- во вкладке «Доступы» одновременно видны:
  - BUSINESS
  - Ценный бухгалтер | 1 ступень 2.0
  - Модуль: Розничная торговля
  - Модуль: Производство
  - Деньги BY 1 тариф
- курс не исчезает из активных карточек из-за наличия модулей;
- нет ручной вставки доступа;
- решение основано на ID-first логике и каноническом access path.

10. Риски и зависимости

Риски:

- Фильтр `productsWithRules` может скрывать легальный доступ, если parent-course entitlement существует, но для его `product_id` нет текущего активного rule.
- Возможен разрыв между admin-вкладкой и пользовательским кабинетом, потому что в `src/components/user/UserSubscriptions.tsx` используется тот же predicate.
- Если у родительского курса должен быть entitlement, но rule/config отсутствует, понадобится не только repair, но и фиксация конфигурации как части root cause.

Зависимости:

- доступ к read-данным БД;
- возможность проверить текущие `access_rules`, `entitlements`, `subscriptions_v2`;
- после approval — выполнение SQL-read, browser verification и при необходимости канонического repair path.

11. Требуется дополнительная информация

Сейчас в read-only режиме я уже подтвердил UI-путь и логику фильтрации, но не могу выполнить SQL-read и repair.
После approval следующего шага нужно:

- прочитать БД по Демко Людмиле;
- определить точный root cause;
- только потом делать execute-патч по одной из двух веток.