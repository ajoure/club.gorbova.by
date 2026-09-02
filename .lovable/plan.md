# Отчет о выполнении: STRICT PLAN-ONLY ревизия PR #420 (опция 3 — патч + ручное подтверждение identity)

## A. Manual Git identity и точный scope — PASS

- База подтверждена объектом: `git rev-parse HEAD` = `4508c9eacd70152686ec5841e528e0e57562f106` (совпадает с `origin/main` в зеркале).
- Head `d0359bffbd421f4c9323d69263933c4af25ba12a` и ветка `origin/codex/products2-manager-consistency` приняты как ручное свидетельство (опция 3); `refs/pull/420/*` не требовался.
- Пре-имидж патча проверен по blob-хешам base-файлов (`git hash-object`), все 5 совпали побайтно:
  - `DealDetailSheet.tsx` → `5f870b6a…cff6` ✓
  - `contact/ContactFeedTab.tsx` → `141e617d…dea5f` ✓
  - `payments/PaymentsFilters.tsx` → `dd549f1f…be58` ✓
  - `payments/PaymentsTable.tsx` → `86ddc89e…19ee8` ✓
  - `lib/crmDisplayLabels.ts` → `cd05ed42…aac0a` ✓
  - `src/test/salesManagerConsistency.test.ts` отсутствует в базе → корректно как new file `0000000…`.
- Scope ровно 6 файлов, только UI/клиентская логика и тест. Миграций, Edge Functions, SQL — нет. Патч внутренне согласован, конфликтов/офсетов нет.

## B. Single-source и confirmed-order mutation contract — PASS

- Единственная запись менеджера — `orders_v2` через RPC в `DealDetailSheet.tsx:169` (`reassignSalesMutation`). Патч не добавляет ни одной мутации на `payments_v2` / `payment_sales_attribution`.
- `PaymentsTable.tsx`, ячейка `case 'sales_manager'`: гейт `hasCanonicalDealLink = payment.rawSource === 'payments_v2' && !!payment.order_id`. И кликабельный менеджер, и пункт меню «Назначить менеджера» вызывают `openDealSheet(payment.order_id!, payment.profile_id)` → загрузка канонической `orders_v2` (`PaymentsTable.tsx:302`).
- `effective_order_id` в патче не используется как цель мутации; он остаётся только в существующей display-ячейке сделки (`PaymentsTable.tsx:586–605`, вне delta). Queue-строки (`rawSource === 'queue'`) и `payments_v2` без `order_id` не дают ни клика, ни пункта меню и показывают требование: «Сначала завершите привязку платежа к сделке».
- Копия в `PaymentsFilters.tsx` переписана корректно: говорит о «текущем версионном назначении платежа», о распространении назначения на связанные платежи и возвраты при смене менеджера в сделке и о сохранении истории. Независимого менеджера платежа не подразумевает.

## C. `set_deal_responsible_v1` и сохранение истории — PASS

- Единственный write-path не изменён: `supabase.rpc("set_deal_responsible_v1", { p_deal_id, p_responsible_user_id, p_reason, p_source: "manual_reassignment" })`. Патч не трогает параметры, не добавляет альтернативных RPC/UPDATE.
- Версионирование остаётся на стороне БД (`20260830083925_sales_manager_attribution_data.sql`: закрытие текущей версии `effective_to`, вставка новых строк, рекурсивный обход `reference_payment_id` для возвратов, `changed_payment_count`). Delta это только отображает.

## D. RBAC `deals.reassign` — PASS

- `PaymentsTable.tsx`: `const { hasPermission } = usePermissions(); const canReassignSales = hasPermission("deals.reassign")`; пункт «Назначить менеджера» рендерится только при `canReassignSales && rawSource === 'payments_v2' && order_id`.
- Кликабельный менеджер без права остаётся навигацией в сделку (read-only), подсказка тогда не обещает изменение менеджера (суффикс «и изменить менеджера» добавляется только при праве).
- Финальный гейт не обходится: сама форма назначения в `DealDetailSheet.tsx:952` под `canReassignSales`, а RPC делает собственную серверную проверку `has_permission(actor,'deals.reassign')`.

## E. Русский рендер аудита / лента контакта — PASS

- `crmDisplayLabels.ts`: добавлены заголовки `deal.sales_manager_changed` → «Изменён менеджер продажи», `deal_sales_manager_assigned_on_create` → «Назначен менеджер продажи».
- `formatSalesManagerAuditDetails` выдаёт: «Менеджер: старый → новый», «Связанных платежей обновлено: N», «Причина: …», «Источник: …» (код источника маппится, неизвестный код заменяется на «Системное назначение», а не показывается сырым).
- Ключи meta совпадают с фактически пишущимися в миграциях: `old_responsible_name`, `new_responsible_name`, `old/new_responsible_user_id`, `changed_payment_count` (`…083925…sql:508–530`) и `responsible_name_snapshot`, `source` (`…085855…sql:195–203`).
- Сырые UUID не выводятся: `managerName()` при отсутствии имени даёт «Сотрудник»/«Без менеджера».
- Исполнитель: в ленте автор теперь `actor_label || имя из profiles(user_id→full_name) || «Система»/«Сотрудник»` — сырых идентификаторов нет.

## F. Инвалидция кэшей — PASS

- `DealDetailSheet.tsx` `onSuccess` теперь инвалидирует `["admin-deals"]`, `["deals-board"]`, `["deal-audit", deal?.id]`, `["unified-payments"]`, `["contact_feed"]`.
- Префиксное совпадение подтверждено фактическими ключами: `useUnifiedPayments.tsx:201` — `["unified-payments", from, to, …]`; `ContactFeedTab.tsx:761` — `["contact_feed", entityId, types, debounced]`. React Query инвалидирует по префиксу, значит оба покрыты.

## G. Находки

Критических находок нет.

Minor-1 (`ContactFeedTab.tsx`, ветка `managerAuditDetails`): `Причина` для событий менеджера выводится «как есть», без `localizeReasonCode`. Для ручного назначения это свободный текст оператора (корректно), но если когда-нибудь RPC вызовут с кодовой причиной, она попадёт в ленту без локализации. Не блокирует.

Minor-2 (`ContactFeedTab.tsx`, `loadPlatformEventsForContact`): добавлен дополнительный запрос к `profiles` по `actor_user_id` на каждую загрузку ленты. Стоимость невелика (≤160 аудит-записей, один `in`-запрос), но это лишний round-trip там, где `actor_label` обычно уже заполнен. Не блокирует.

## H. Итог

**PASS**. Патч соответствует контракту B–F, риск ограничен UI-слоем.

Rollback: при необходимости — только revert PR #420. Никакие миграции, функции и данные откатывать не нужно; PR #401/#414–#419 не затрагиваются.

## Подтверждение объема воздействия

- migrations: 0
- Edge Functions: 0
- data writes: 0
- deploy: 0
- Publish: 0

Ревизия завершена, изменения не вносились.
