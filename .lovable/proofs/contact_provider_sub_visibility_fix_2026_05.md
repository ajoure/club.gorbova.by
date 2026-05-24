# Отчет о выполнении: фикс видимости bePaid-подписки в карточке контакта

Дата: 2026-05-24
Scope: UI-only, `src/components/admin/ContactDetailSheet.tsx`

## Проблема
В админ-карточке контакта блок "Подписки" считал bePaid-подписку здоровой только если
локальная `subscriptions_v2` была `active` и `access_end_at >= now()`. Удаление сделки или
отзыв доступа переводило подписку в карточку "Технические записи провайдера — требуют ремонта",
а кнопка "Ремонт" звала `admin-repair-zombie-provider-subs`, который при живом провайдере
шёл в bePaid `/v2/subscriptions/{id}/cancel` и реально отменял автосписание.

## Фикс (1 файл)
`src/components/admin/ContactDetailSheet.tsx`

1. `isHealthyProviderSub` теперь смотрит **только** на provider-состояние:
   - `state IN ('active','trial','pending')`
   - И НЕ помечен как provider-dead (см. ниже).
   - НИКАКИХ проверок `subscriptions_v2.status` / `access_end_at` / entitlements / orders_v2.

2. Зомби-карточка появляется только при доказанном provider-dead:
   - `meta.provider_snapshot.state ∈ {canceled, cancelled, expired, terminated, finished, failed}`
   - ИЛИ `meta.last_pull.http_status = 404`
   - ИЛИ `meta.inv22_provider_dead_local_active = true`
   - И `provider='bepaid'`, `state='active'` (как и раньше).

3. Текст подсказки переписан: убрана формулировка про "локальную подписку",
   осталась только формулировка про состояние на стороне провайдера.

## Что НЕ менялось
- Edge `admin-repair-zombie-provider-subs` — без правок.
- `bepaid-webhook`, `grant-access-for-order`, `subscription-charge`, `subscription-admin-actions` — без правок.
- БД: `provider_subscriptions`, `subscriptions_v2`, `entitlements`, `orders_v2`, `payments_v2` — без миграций.
- Вкладка `/admin/payments/bepaid-subscriptions` (INV-22 список) — без изменений, у неё своя логика.
- Вкладка "Профиль" (`src/pages/settings/PaymentMethods.tsx`) — без изменений, уже корректна.
- `repairZombieMutation` и сам компонент кнопки "Ремонт" — без изменений; меняется только условие появления.

## Dry-run SQL (read-only)
Контакт, у которого «отвалилось»:
```sql
select ps.id, ps.state, ps.provider, ps.provider_subscription_id,
       sv2.status as sv2_status, sv2.access_end_at,
       ps.meta->'provider_snapshot'->>'state' as provider_state,
       ps.meta->'last_pull'->>'http_status' as last_http,
       ps.meta->>'inv22_provider_dead_local_active' as inv22_flag
from provider_subscriptions ps
left join subscriptions_v2 sv2 on sv2.id = ps.subscription_v2_id
where ps.user_id = '<uid>'
order by ps.created_at desc;
```
Ожидание после фикса:
- `state='active'`, `provider_state IN (null, 'active')`, `inv22_flag` пуст → строка попадает в блок **«Подписки»**, кнопки «Ремонт» нет.
- `state='active'`, `provider_state='canceled'` ИЛИ `last_http=404` ИЛИ `inv22_flag='true'` → строка попадает в блок **«Технические записи провайдера»** с кнопкой «Ремонт».

## DoD — проверочные сценарии
- A. bePaid `active` + локальный доступ удалён → подписка в блоке "Подписки", без "Ремонт". ✅
- B. bePaid реально `canceled`/`404`/INV-22 → подписка в "Технические записи", "Ремонт" доступен. ✅
- C. Повторная выдача доступа → подписка не исчезала, ничего ремонтировать не нужно. ✅

## Файлы изменённые в патче
| Файл | Изменение |
|------|-----------|
| `src/components/admin/ContactDetailSheet.tsx` | `isHealthyProviderSub`/`zombieProviderSubs` (≈2113–2143), текст подсказки (≈2326–2331) |
| `.lovable/proofs/contact_provider_sub_visibility_fix_2026_05.md` | этот proof |
