Дополнение к плану:

Перед execute обязательно проверить, что `previous_status` внутри `meta.inv_phantom_parent_v1` реально читается именно по пути:

meta->'inv_phantom_parent_v1'->>'previous_status'

Если в части строк ключ отсутствует, не пропускать их молча — вывести в dry-run как `missing_previous_status` и не менять до ручного решения.

Также после data-revert обязательно сделать React Query/cache invalidation или явно указать пользователю обновить страницу/перелогиниться, иначе UI может продолжить показывать старое состояние.

&nbsp;

План: восстановить ошибочно деактивированные entitlements (INV-PHANTOM-PARENT-V1) и починить resolver видимости тренингов.

## 1. Проблема

- INV-PHANTOM-PARENT-V1 был трактован неверно: parent-entitlements, выданные через BUSINESS как бонусное восстановление доступа к ранее купленным продуктам/модулям, ошибочно классифицированы как «фантомные» и переведены в `status='superseded'` batch-ем `INV-PHANTOM-PARENT-V1-2026-05-13` (23 строки).
- Эти строки должны оставаться `active` и управлять видимостью в «Моей библиотеке».
- По Алене Богинской (`lena_times@mail.ru`) ошибочно отключена строка root-доступа `Ценный бухгалтер | 1 ступень 2.0`, что в текущей UI-логике может приводить к исчезновению root-карточки тренинга при сохранённом доступе к standalone-модулям «Маркетплейсы» и «Строительство».

## 2. Source of Truth

- SOT видимости в «Моей библиотеке» = карточка контакта → вкладка «Доступы».
- Если active entitlement есть в «Доступах» (status='active', expires_at>now() или NULL) — соответствующий продукт/тренинг ОБЯЗАН отображаться пользователю.
- Никакая комбинация `meta.scope_resolution_mode`, `historical_module_product_ids`, `inv_phantom_parent_v1` не должна скрывать сам parent product.

## 3. Диагностика (факты)

- Профиль: `lena_times@mail.ru` → Алена Богинская, `user_id=78123ed5-3a00-4982-87cf-72de6c0cdb8c`.
- Active entitlements сохранены: Gorbova Club, Бухгалтерия как бизнес, ЗАКРОЙ ГОД, Подоходный налог с физлиц, Деньги BY 1 тариф, ЦБ 2 ступень 3 поток, ЦБ 1 ступень 2.0 модуль Маркетплейсы (standalone), ЦБ 1 ступень 2.0 модуль Строительство (standalone).
- Superseded ошибочно: entitlement `c56c29d6-631a-4d9d-9e3f-1e63d2686c20` на product `7101ed3c… (Ценный бухгалтер | 1 ступень 2.0)`, `previous_status=active`, `expires_at=2026-05-16 20:59:59+00`, `meta.inv_phantom_parent_v1.batch=INV-PHANTOM-PARENT-V1-2026-05-13`.
- По batch-у всего 23 строки superseded, 23 уникальных пользователя.
- Текущий `useSidebarModules` строит видимость root тренинга строго по active `entitlements.product_id` для root-продукта. Standalone-модульные entitlements с другим `product_id` НЕ показывают родительский тренинг ЦБ-1.

## 4. Изменяемые компоненты

- Данные: только `public.entitlements` — обратное обновление статуса для строк с `meta.inv_phantom_parent_v1.batch='INV-PHANTOM-PARENT-V1-2026-05-13'`.
- Resolver: `src/hooks/useSidebarModules.ts` и `src/hooks/useTrainingContentRules.ts` — не скрывать parent product при наличии active entitlement, корректно учитывать `historical_module_product_ids` как ограничитель/расширитель списка модулей, не как kill-switch для root.
- CREATE-guard: `supabase/functions/_shared/product-access-grants.ts` (логика `inv_phantom_parent_v1:hpids_outside_target`) — пересмотреть: BUSINESS-выданный bonus parent с hpids вне subtree это легитимный сценарий, его нельзя блокировать как phantom.
- Memory: `mem://architecture/access-control/phantom-parent-entitlement-guard` обновить (правило отменено/переписано), `mem://architecture/access-control/cabinet-visibility-entitlement-dependency` дополнить SOT-формулировкой про карточку «Доступы».

## 5. Что НЕ будет изменено

- `subscriptions_v2` — не трогать.
- `provider_subscriptions`, bePaid — не трогать.
- `access_end_at` ни в подписках, ни в entitlements — не менять.
- Telegram (`telegram_grant_access`, `telegram_manual_access`, queues) — не трогать.
- Новые entitlements не создавать.
- Существующие entitlements не удалять и не сокращать срок.
- Только восстановить ошибочно отключённые + исправить resolver.

## 6. Dry-run

1. Read-only выборка по batch:
  - `select * from entitlements where meta->'inv_phantom_parent_v1'->>'batch'='INV-PHANTOM-PARENT-V1-2026-05-13'` → 23 строки;
  - для каждой строки: `previous_status`, `expires_at`, `user_id`, email, `product_id`, `product_name`, `historical_module_product_ids`, текущие active entitlements того же user_id;
  - кандидаты на revert: `previous_status='active'` AND `expires_at > now()`;
  - не-кандидаты (если есть): причина по каждой (expired до даты execute, previous_status не active, продукт удалён и т.п.).
2. Read-only resolver-симуляция по каждому затронутому пользователю:
  - до revert: какие тренинги видны;
  - после revert: какие тренинги станут видны;
  - проверка, что standalone-модули не теряют доступ.
3. Сохранить артефакт `/mnt/documents/inv_phantom_parent_v1_revert_dryrun.md` со списком 23 строк и решением по каждой.

STOP-guards:

- Если кандидатов > 23 — стоп, расследование расширения batch.
- Если хоть одна строка имеет `expires_at <= now()` — не возвращать в active, фиксировать причиной в отчёте.
- Если revert по строке вернёт user-у доступ к продукту, на который у него никогда не было ни orders_v2.paid, ни business-grant audit — стоп, отдельное обсуждение.
- Если есть конфликт с другим active entitlement по тому же `(user_id, product_id)` — мерж по `GREATEST(expires_at)`, никогда не уменьшать.

## 7. Execute

1. Migration update по `entitlements`:
  - WHERE `meta->'inv_phantom_parent_v1'->>'batch'='INV-PHANTOM-PARENT-V1-2026-05-13'`
   AND `status='superseded'`
   AND `(meta->'inv_phantom_parent_v1'->>'previous_status')='active'`
   AND `(expires_at IS NULL OR expires_at > now())`;
  - SET `status='active'`,
  `meta = meta || jsonb_build_object('reverted_inv_phantom_parent_v1', true, 'reverted_at', now(), 'revert_reason', 'business_bonus_parent_misclassified_as_phantom_2026_05_13')`;
  - audit_logs по каждой строке: `action='entitlement.reverted.inv_phantom_parent_v1'`, `actor_type='system'`, `actor_label='inv_phantom_parent_v1_revert'`, `target_user_id`, `meta` со ссылкой на batch и `entitlement_id`.
2. Resolver-fix (frontend, презентационный слой):
  - В `useSidebarModules`: при `effectiveProductId != null` и наличии active entitlement на этот product_id — root всегда `has_access=true`, без зависимости от `synthetic_legacy`/`rule_unresolved` фильтров.
  - В `resolveTrainingContentFilter`: для строк типа `module_scope_only` с непустым `historical_module_product_ids` — фильтр работает только как allowlist child-модулей; root-модуль НЕ исключается, если active entitlement существует на parent product.
  - Standalone module-products продолжают отображаться как отдельные карточки, не глушат parent.
3. CREATE-guard в `product-access-grants.ts`:
  - Пересмотреть кейс `inv_phantom_parent_v1:hpids_outside_target` так, чтобы он не блокировал business-bonus parent. Минимально — снять блок INSERT, оставить аудит-метку, без отказа.

## 8. Verify / DoD

- 23 ошибочно superseded entitlements: либо восстановлены в `active` с пометкой `reverted_inv_phantom_parent_v1=true`, либо по каждому в отчёте указана конкретная причина, почему revert не выполнен.
- По Алене Богинской:
  - строка ЦБ-1 root `c56c29d6-…` снова `active`;
  - в карточке контакта → «Доступы» строка ЦБ-1 видна как «Активен»;
  - в «Моей библиотеке» виден тренинг `Ценный бухгалтер | 1 ступень 2.0` и его модули по правилам resolver;
  - модули `Маркетплейсы` и `Строительство` остаются видимы;
  - остальные active entitlements не изменились;
  - audit_logs содержит revert-запись.
- По «ЗАКРОЙ ГОД»:
  - active entitlement в «Доступах» → тренинг виден в библиотеке (proof по конкретному пользователю с active entitlement).
- По всем продуктам с `training_modules`:
  - инвариант: для каждой пары `(user_id, product_id)` с active entitlement и существующим training root → root обязан проходить resolver visibility.
  - read-only sweep после execute: `remaining_broken_cases (active_entitlement AND invisible_training_root) = 0`.
- Memory обновлена: правило про phantom-parent отменено/переписано, SOT «карточка Доступы = SOT видимости библиотеки» закреплён.
- Backlog `inv_phantom_parent_permanent_detector` переоформлен: детектор не должен помечать business-bonus parent как phantom.

## 9. Риски и зависимости

- Риск: для какой-то строки revert вернёт доступ к продукту, к которому у пользователя нет легитимного основания. Mitigation: STOP-guard по orders_v2/business audit.
- Риск: resolver-fix может расширить видимость у пользователей, у которых остался legacy active entitlement без orders_v2 paid. Mitigation: resolver не выдаёт доступ, он только не скрывает то, что уже есть в `entitlements`. SOT остаётся `entitlements`.
- Зависимости: фронтенд-кэш React Query (`["sidebar-modules", ...]`, `["active-training-content-rules", ...]`) — потребует invalidation после revert.

## 10. Порядок исполнения (после approval)

1. Сформировать dry-run артефакт по 23 строкам.
2. Применить data-revert миграцию.
3. Применить resolver-fix во фронтенде + снять блок CREATE-guard для business-bonus.
4. Verify по Алене, по «ЗАКРОЙ ГОД», по sweep всех продуктов с training_modules.
5. Обновить memory + backlog detector.
6. Финальный отчёт «Отчет о выполнении».