# PLAN-ONLY ревизия PR #424 — финальное исправление спринта «Продукты 2»

**SHA:** `f05f83e5bd6c3d1e8ef65eeff0492199d39e8d0b` (HEAD рабочего дерева совпадает, merge PR #424 из `codex/products2-contact-audit-final`, коммит `8e51055e1`).
**Режим:** READ-ONLY. Код, миграции, функции, данные, deploy, Publish — не изменялись.

## Вердикт: PASS

## Проверки

### 1) Идентификаторы сделок контакта — PASS
- `ContactFeedTab.tsx:862-864` — `rpcDealIds` извлекаются из событий `contact_feed_list` с `kind === "deal"` и валидацией UUID (`/^[0-9a-f-]{36}$/i`).
- RPC `contact_feed_list` (миграция `20260704182851`, строки 262-292) возвращает deal-события с `id = o.id` (UUID заказа), разрешённые через `profiles.user_id = orders_v2.user_id` — идентификаторы подлинные.
- `ContactFeedTab.tsx:510-515` — заказы ищутся независимыми точными запросами: `eq("profile_id", contactId)` (авторитетный, его ошибка пробрасывается), плюс безопасные fallback: `eq("user_id")`, `ilike("customer_email")`, `ilike("customer_phone")`. Ошибки fallback-веток игнорируются, результаты дедуплицируются по `id` и сортируются. Прежний комбинированный `.or(orderOr...)` удалён — устранён риск тихой инвалидации всего запроса legacy-значением.

### 2) Область аудита — PASS
- `ContactFeedTab.tsx:563-568` — аудит ограничен `.in("entity_id", [contactId, ...orderIds.slice(0, 20)])`.
- Фильтров `actor_user_id.eq` / `target_user_id.eq` / `meta.ilike` нет (проверено и текстовым тестом `salesManagerConsistency.test.ts`). Утечка чужих событий через actor/target исключена; actor используется только для отображения имени.

### 3) deal.sales_manager_changed для ORD-26-00306 — PASS (с оговоркой)
- Запись аудита пишется с `entity_id` = UUID сделки; если сделка попадает в `orderIds` (через RPC по user_id или прямые запросы) — событие попадёт в ленту связанного контакта.
- Русский рендер подтверждён тестом: `localizeAuditAction("deal.sales_manager_changed")` → «Изменён менеджер продажи»; `formatSalesManagerAuditDetails` выводит «Менеджер: X → Y», «Связанных платежей обновлено: N», «Причина», «Источник».
- **Оговорка (не блокер):** `auditEntityIds` ограничен `orderIds.slice(0, 20)` — у контакта с >20 сделками аудит старших сделок может не попасть в ленту. Для ORD-26-00306 (свежая сделка) это не влияет.

### 4) Незатронутость платежей/RLS/миграций/Edge Functions/данных — PASS
- Diff `861a515b..f05f83e5`: только `src/components/admin/contact/ContactFeedTab.tsx` (+43/-12) и `src/test/salesManagerConsistency.test.ts` (+5). Миграций, SQL, Edge Functions, изменений payments_v2/RLS нет.

## Блокеры
Нет.

## Технические детали
- Base: `861a515b2355576961e49f213bccb6e4be646ed3` (релиз PR #423).
- Изменённые файлы: 2 (UI + тест), суммарно 48+/12-.
- Известная оговорка: лимит `slice(0, 20)` на deal-ids в аудит-запросе; при необходимости — follow-up отдельной задачей.
