# Telegram карточка контакта — effective access resolver (Вариант A)

**Дата:** 2026-05-05
**Scope:** read-only resolver + UI. Никаких write-действий, cron/schema без изменений.

## Что сделано

### 1. RPC `admin_get_club_memberships_all` обновлена

Резолвит для каждого активного клуба:
- продукт через `access_rules` (`grant_target_type='club'`, `target_ref::uuid = club.id`, `product_id IS NOT NULL`)
- `entitlements` по `(user_id, product_id)` с проверкой `status='active' AND expires_at > now()`
- если у клуба несколько привязанных продуктов — выбирается «лучший» приоритетом `active > expired > missing > unknown`.

Добавлены поля:
- `telegram_access_status` (старый `tcm.access_status`, для UI-предупреждения)
- `effective_access_status` ∈ `active | expired | missing | unknown_product`
- `linked_product_id`, `linked_product_name`
- `entitlement_id`, `entitlement_status`, `entitlement_expires_at`

`telegram_club_members.access_status` **не обновляется**.

### 2. UI `ContactClubMembershipsList`

- Зелёный «Доступ активен» только при `effective_access_status='active'`.
- `expired` → красный «Доступ истёк», `missing` → красный «Нет доступа», `unknown_product` → жёлтый «Клуб не привязан к продукту».
- Если `telegram_access_status='ok'`, но реального доступа нет → отдельный жёлтый бейдж «TG-статус устарел» с пояснением.
- Tooltip access-бейджа показывает: продукт клуба, entitlement.status + срок, raw TG-статус.
- Presence-иконки (чат/канал) и сам факт «человек в чате» отделены от access-бейджа.

### 3. Кейс Анны Главчинской (`profile_id=14d620f0-…`)

| Клуб | TG status | Linked product | Entitlement | Effective | UI |
|---|---|---|---|---|---|
| Gorbova Club | removed | Gorbova Club | expired (до 21.03.2026) | **expired** | красный «Доступ истёк» |
| Бухгалтерия как бизнес | **ok** (stale) | Бухгалтерия как бизнес | нет | **missing** | красный «Нет доступа» + жёлтый «TG-статус устарел» |

Зелёного «Доступ активен» по «Бухгалтерии» больше нет.

### 4. SQL-аудит масштаба проблемы

Записей `telegram_club_members.access_status='ok'`, по которым реально нет active entitlement по продукту клуба:

```
stale_ok_no_active_ent = 316
```

Это снимок — НЕ исправлялся, только зафиксирован. Чинить отдельной задачей при необходимости (write-path).

## Что НЕ сделано (явно)

- ❌ нет UPDATE по `telegram_club_members`
- ❌ нет revoke / kick / invite
- ❌ access writers / cron / schema не менялись
- ❌ кнопок ручного re-check не добавлено
