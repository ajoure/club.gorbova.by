да, согласен, с учетом правок:

&nbsp;

1. Зеркала нельзя жёстко приравнивать к subscriptions_v2.access_end_at.  
В нескольких местах плана это ещё звучит слишком жёстко.  
Правильно так:  

  - telegram_access.active_until
  - telegram_access_grants.end_at  
  должны совпадать не с сырой датой подписки, а с effectiveEndAt из shared helper для конкретного club_id.  
  Иначе сломается кейс:
  - несколько product_id на один клуб;
  - active entitlement;
  - manual access;
  - бессрочный доступ.
2. &nbsp;
3. В renewal notification дата должна браться не из resolveEffectiveProductAccess, а по смыслу сообщения.  
У тебя сейчас в плане:  

  - продукт — из subscriptions_v2.product_id;
  - дата — через resolveEffectiveProductAccess.  
  Это корректно только для продуктового доступа.  
  Но если в сообщение добавляются ссылки на конкретный клуб, то дата для блока доступа в Telegram должна считаться через resolveEffectiveClubAccess(userId, clubId).  
  Иначе снова можно получить расхождение: продукт продлён до одной даты, а клуб фактически доступен до другой.
4. &nbsp;
5. В subscription-charge обновление зеркал делать не newEndDate, а итогом shared helper после обновления подписки.  
Сейчас в плане написано:  

  - telegram_access.active_until = newEndDate
  - telegram_access_grants.end_at = newEndDate  
  Это надо заменить на:
  - сначала обновить подписку;
  - потом вызвать resolveEffectiveClubAccess(...);
  - потом записать в зеркала именно effectiveEndAt.  
  Иначе зеркала снова могут стать короче/длиннее реального доступа.
6. &nbsp;
7. В DoD заменить пункт  
subscriptions_v2.access_end_at = telegram_access.active_until = telegram_access_grants.end_at  
на более правильный:  

  - telegram_access.active_until = telegram_access_grants.end_at = effectiveEndAt(shared helper)  
  А subscriptions_v2.access_end_at — это только один из возможных входов в helper, но не всегда итоговая дата.
8. &nbsp;
9. Нужен явный кейс “один продукт → несколько клубов” и “несколько продуктов → один клуб”.  
Сейчас multi-club case есть, это хорошо, но надо дополнить ещё двумя архитектурными сценариями:  

  - один product_id маппится на несколько club_id;
  - один club_id маппится на несколько product_id.  
  Для обоих кейсов подрядчик должен показать, что:
  - даты не смешиваются;
  - уведомления не путают клубы;
  - зеркала обновляются адресно.
10. &nbsp;
11. Если renewal notification охватывает несколько клубов, нужен формат сообщения.  
Это надо дописать в план.  
Нельзя отправлять одно сообщение с “усреднённым” названием/датой.  
Должно быть либо:  

  - одно сообщение на каждый клуб,  
  либо
  - один message body с отдельными блоками по каждому клубу:  

    - название клуба
    - доступ до
    - соответствующие кнопки входа
  - &nbsp;
12. &nbsp;
13. NULL = бессрочно нужно явно проверить и для зеркал.  
В helper это уже учтено в плане, но надо дописать в DoD:  

  - если effective access бессрочный, зеркала не должны получать фиктивную дату;
  - надо определить и зафиксировать, как именно это хранится в зеркалах:  

    - NULL
    - либо специальный sentinel  
    И использовать один и тот же контракт везде.
  - &nbsp;
14. &nbsp;
15. telegram-check-expired и telegram-kick-violators должны не просто “использовать тот же подход”, а вызывать один и тот же helper буквально.  
Это уже почти прописано, но лучше усилить формулировку:  

  - никаких локальных вычислений срока в этих функциях;
  - только прямой вызов shared helper.
16. &nbsp;
17. В Phase 0 discovery добавь отдельный read-only proof по полям времени.  
Помимо timezone discovery, подрядчик должен показать:  

  - в каком timezone хранятся access_end_at, next_charge_at, active_until;
  - где дата нормализуется до конца дня, а где до точного timestamp;
  - нет ли смешения date vs timestamp.  
  Это важно для бага “кик в тот же день”.
18. &nbsp;
19. Финальный вывод:  
После этих правок план можно считать финальным.  
Основа правильная, но критично исправить одно:  
зеркала и уведомления должны опираться на effectiveEndAt(shared helper), а не напрямую на subscriptions_v2.access_end_at / newEndDate.

&nbsp;

# План: Единая система доступа — фикс дат, уведомлений, защита от ложного revoke

---

## STOP-guard

Выполнение запрещено до Phase 0 (read-only discovery). Если discovery покажет, что UI/уведомления/kick используют разные пути расчёта дат — сначала привести все к единому helper, только потом фиксить отдельные функции.

---

## Phase 0: Read-only discovery (обязательный, до любых правок)

### 0.1 Каноническая карта Source of Truth

```text
═══════════════════════════════════════════════════════
CANONICAL (Source of Truth — runtime-доступ считается ТОЛЬКО из них):
  subscriptions_v2.access_end_at    — срок платной подписки по продукту
  entitlements.expires_at           — срок по разовым/служебным доступам
  telegram_manual_access.valid_until — срок ручного доступа

  NULL = бессрочный доступ (для entitlements.expires_at и telegram_manual_access.valid_until).
  Helper обязан корректно обрабатывать NULL как "бессрочно", а не как "нет даты".

DERIVED / SYNC (зеркала, не SoT, обновляются при grant/renew):
  telegram_access.active_until      — производная
  telegram_access_grants.end_at     — производная

MEMBERSHIP STATE (факт нахождения, не срок доступа):
  telegram_club_members             — in_chat, in_channel, access_status

НЕ УЧАСТВУЮТ В RUNTIME-ДОСТУПЕ:
  orders_v2 / payments_v2           — биллинг; допустим только как fallback для суммы
  deals / amoCRM                    — коммерческий/аналитический слой
  orders_v2                         — НЕ источник названия продукта
                                      (брать из subscriptions_v2.product_id → products_v2.name)
═══════════════════════════════════════════════════════
```

### 0.2 Архитектурная матрица: кто что читает / пишет

```text
┌─────────────────────────────┬──────────────────────────────────┬──────────────────────────────────┬────────────────────────┐
│ Процесс                    │ Читает                           │ Пишет                            │ Итоговая дата          │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ grant-access-for-order      │ orders_v2, tariffs, access_rules │ subscriptions_v2, entitlements,  │ resolveAccessWindow    │
│                             │ products_v2, tariff_offers       │ telegram_access_queue, ledger    │                        │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ subscription-charge         │ subscriptions_v2, tariffs,       │ subscriptions_v2.access_end_at,  │ calcCalendarMonthEnd   │
│                             │ payment_methods, orders_v2       │ entitlements, telegram_access_   │ / tariff.access_days   │
│                             │                                  │ queue (grant—БАГ), payments_v2   │                        │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ telegram-grant-access       │ telegram_clubs, subscriptions_v2 │ telegram_access.active_until,    │ MAX(sub.access_end_at) │
│                             │ (БАГ: без product_id фильтра)   │ telegram_access_grants.end_at,   │ — БЕЗ product scope!  │
│                             │                                  │ telegram_club_members            │                        │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ subscription-renewal-       │ subscriptions_v2.access_end_at   │ telegram_logs, send-email        │ sub.access_end_at      │
│ reminders                   │ (day-window, БАГ: нет re-check) │                                  │                        │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ subscription-grace-         │ subscriptions_v2, orders_v2      │ subscriptions_v2.grace_*,        │ access_end_at +        │
│ reminders                   │ (БАГ: без product_id, хардкод)  │ telegram_logs, send-email        │ grace_hours            │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ telegram-check-expired      │ telegram_access.active_until,    │ telegram_access_grants.status,   │ hasValidAccess         │
│                             │ hasValidAccess (6 источников)    │ вызывает telegram-revoke-access  │ (нет audit_logs!)      │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ telegram-revoke-access      │ hasValidAccess (guard), clubs,   │ telegram_access, _grants,        │ hasValidAccess         │
│                             │ telegram_club_members            │ _club_members, audit_logs, DM   │ (audit/DM есть)        │
├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────────┼────────────────────────┤
│ telegram-kick-violators     │ telegram_club_members,           │ _club_members.access_status,     │ hasValidAccessBatch    │
│                             │ hasValidAccessBatch              │ audit (logAudit), ledger         │ (audit есть, DM нет!) │
└─────────────────────────────┴──────────────────────────────────┴──────────────────────────────────┴────────────────────────┘
```

### 0.3 Invariant: правило единой даты

Одна и та же дата доступа должна совпадать в:

- карточке доступа в UI
- тексте Telegram/Email уведомления
- `telegram_access.active_until`
- `telegram_access_grants.end_at`
- `hasValidAccess` (решение о revoke/kick)

Все вычисляются через **один shared helper**.

### 0.4 Правило по клубу

Для клуба `effectiveEndAt` = MAX только среди **валидных** источников:

1. active/trial/past_due подписки по всем `product_club_mappings.product_id` для данного `club_id` (+ 72h grace)
2. active entitlements по тем же product_id
3. active manual access по club_id
4. billing-day/grace protection, если действует

**NULL = бессрочно** — если хотя бы один источник даёт `NULL` (expires_at IS NULL), helper возвращает `isUnlimited = true`, `effectiveEndAt = null`.

**Не** брать максимум по всем записям пользователя глобально.

### 0.5 Timezone discovery (обязательный, до unify)

**Не менять timezone вслепую.** Текущее состояние в коде:

- `timezone.ts`: `APP_TZ = 'Europe/Minsk'`
- `accessValidation.ts`: `WARSAW_TZ = 'Europe/Warsaw'` (для billing-day protection)

Перед унификацией timezone нужен read-only proof:

- какой timezone фактически используется в production для next_charge_at, access_end_at, UI
- есть ли расхождения между функциями
- только после proof — решение и unify

### 0.6 Discovery proof: диагностические запросы BEFORE

1. **SoT vs зеркала drift** — `subscriptions_v2.access_end_at` vs `telegram_access.active_until`
2. **Ошибочно removed** — removed пользователи с валидным доступом (sub + ent + manual)
3. **Removed без audit** — removed/kicked без записи в `audit_logs` + каким процессом
4. **Expired но не kicked** — in_chat=true без валидного доступа
5. **Stale reminders** — уведомления, отправленные после продления
6. **Не тот клуб в уведомлении** — renewal notification: сравнение product_id подписки vs club_id, в который ушли ссылки, vs product_club_mappings

---

## Phase 1: Единые shared helpers (центр патча)

### 1.1 `_shared/resolve-effective-access.ts` (НОВЫЙ, обязательный)

**Контракт возвращаемого значения (полный access snapshot):**

```text
{
  effectiveEndAt: Date | null,    // null = бессрочно
  isUnlimited: boolean,           // true если хотя бы один источник даёт NULL expires
  isProtectedByBillingDay: boolean,
  sourceType: 'subscription' | 'entitlement' | 'manual_access',
  sourceId: string,
  allSources: Array<{
    type: string,
    id: string,
    endAt: Date | null,
    productId: string | null,
  }>
}
```

`**resolveEffectiveClubAccess(supabase, userId, clubId)**`:

1. `product_club_mappings` → все active `product_id` для club_id
2. MAX(`subscriptions_v2.access_end_at`) по этим product_id, statuses active/trial/past_due + grace
3. MAX(`entitlements.expires_at`) по этим product_id, status=active
4. MAX(`telegram_manual_access.valid_until`) по club_id
5. Billing-day protection
6. **NULL-safe**: если ANY source даёт NULL → `isUnlimited = true`, `effectiveEndAt = null`

`**resolveEffectiveProductAccess(supabase, userId, productId)**` — аналогично, без клубной обвязки.

**Обязательные потребители**: telegram-grant-access, subscription-charge (renewal notification), subscription-renewal-reminders, subscription-grace-reminders, telegram-check-expired, telegram-kick-violators.

**Запрет**: никакие функции больше не имеют права самостоятельно вычислять activeUntil / access window.

Этот же snapshot пишется в `audit_logs.meta.access_snapshot` при revoke/kick.

### 1.2 `_shared/invite-link-helper.ts` (НОВЫЙ)

Общий helper для генерации invite links. Используется и в `telegram-grant-access`, и в `subscription-charge` renewal notification. Один источник, один формат кнопок.

### 1.3 Billing-day protection: end-of-day guard

**Файл**: `_shared/accessValidation.ts`, строки 19-21, 88-92.

**Текущее**: `BILLING_DAY_PROTECTION_HOURS = 12`, `WARSAW_TZ = 'Europe/Warsaw'`.

**Фикс**: После timezone discovery — привести к единому timezone. Заменить `12h` на расчёт до конца дня в согласованном timezone. Использовать `dayWindowUtc` из `timezone.ts`.

---

## Phase 2: Фиксы edge functions

### 2.1 telegram-grant-access: activeUntil по всем продуктам клуба

**Файл**: строки 579-603.
**Проблема**: `activeUntil` берётся по `user_id` без `product_id`.
**Фикс**: Заменить на вызов `resolveEffectiveClubAccess(supabase, userId, club.id)`.

### 2.2 subscription-charge: renew invariants

**Файл**: строки 1705-1754.

**Invariants block (renew)**:

- Renew НЕ запускает повторный grant-flow / onboarding
- Renew НЕ переоткрывает доступ, если уже активен
- Renew только: продлевает срок → обновляет зеркала → отправляет одно уведомление с ссылками

**Фикс A — проверка existing member по каждому club_id отдельно** (строки 1714-1737):

Для каждого `mapping` из `product_club_mappings`:

- Проверить `telegram_club_members` по `user_id + mapping.club_id`
- Если user уже active/ok/joined **в этом клубе** → НЕ ставить grant для этого клуба, а обновить зеркала:
  - `telegram_access.active_until` = newEndDate (по `user_id + club_id`)
  - `telegram_access_grants.end_at` = newEndDate (по `user_id + club_id`, status='active')
  - `telegram_access.last_sync_at` = now
- Если user **ещё не в этом клубе** → grant по-прежнему нужен (upsert в очередь)

Обновление зеркал — **только по клубам, связанным с product_id подписки**, не глобально.

**Фикс B — ссылки в `sendRenewalSuccessTelegram**` (строки 317-377):

- Добавить `productId` в сигнатуру
- Использовать shared `invite-link-helper.ts`
- Дата доступа через `resolveEffectiveProductAccess`
- Продукт: из `subscriptions_v2.product_id` → `products_v2.name` (не из orders_v2)
- Добавить `inline_keyboard` с кнопками входа в чат/канал
- Если один ресурс — одна кнопка, если несколько — все релевантные

### 2.3 subscription-grace-reminders: сумма, продукт, anti-stale

**Файл**: строки 90-105 (хардкод), 296 (SELECT), 363-387 (сумма).

**Фикс A — Сумма** (строгий приоритет):

1. `sub.meta.recurring_amount` или `sub.meta.recurring_snapshot.amount`
2. `tariff_prices.final_price` по `sub.tariff_id`
3. Fallback: `orders_v2.final_price` по `user_id + product_id` (не глобально!)

**Фикс B — Продукт**:

- Добавить `product_id` в SELECT (строка 296)
- Получить `products_v2.name` по `sub.product_id`
- Убрать хардкод `Gorbova Club` (строка 95)
- `orders_v2` не используется для названия продукта вообще

**Фикс C — Anti-stale guard**:

- Перед стартом grace перечитать `subscriptions_v2` **по `sub.id**` (не косвенно)
- Сравнить свежие `access_end_at`, `status`, `updated_at`
- Если подписка уже продлена / access_end_at уже сдвинулся (> now) — пропустить

### 2.4 subscription-renewal-reminders: anti-stale guard

**Файл**: строки 837+.

**Фикс**: В цикле (строка 837) перед отправкой напоминания перечитать `subscriptions_v2` **по `sub.id**`:

- Если `access_end_at` уже сдвинулся (> windowEnd) — пропустить
- Если `status` изменился — пропустить
- Защита от race condition charge → reminder

### 2.5 telegram-check-expired: audit_logs с system actor

**Файл**: строки 148-186.

**Сейчас**: есть ledger (строки 167-186), но нет записи в `audit_logs`.
**Фикс**: После успешного вызова revoke (строка 152) добавить:

```text
audit_logs.insert({
  action: 'telegram.access_expired_revoke',
  actor_type: 'system',
  actor_user_id: null,
  actor_label: 'telegram-check-expired',
  target_user_id: access.user_id,
  meta: {
    reason_code: 'subscription_expired',
    reason_text: 'Срок доступа истёк',
    club_id: access.club_id,
    access_snapshot: <из resolveEffectiveClubAccess>
  }
})
```

**Обязательно**: использовать `resolveEffectiveClubAccess` (тот же helper, что и в telegram-grant-access), а не параллельную логику.

### 2.6 telegram-revoke-access: улучшить DM

**Файл**: строка 613.

**Сейчас**: `❌ Доступ отозван\n\nДоступ к чату и каналу клуба закрыт.` — нет причины, нет названия клуба.
**Фикс**: Добавить человекочитаемую причину и название клуба. DM **только после фактического** успешного ban.

### 2.7 telegram-kick-violators: добавить DM

**Файл**: строки 445-471.

**Сейчас**: есть audit через `logAudit` (строка 459), нет DM.
**Фикс**:

- После **фактического** успешного kick (строка 445 `if (kickedFromChat || kickedFromChannel)`)
- Сначала update membership state
- Потом audit
- Потом DM через link-bot с причиной
- Порядок: факт кика → audit → DM (не наоборот)

**Обязательно**: использовать `hasValidAccessBatch` / `resolveEffectiveClubAccess` — тот же shared helper, а не параллельную логику.

---

## Phase 3: Диагностические запросы (BEFORE / AFTER)

Все запросы выполняются **дважды**: baseline до execute и повтор после. Сравнение результатов — обязательная часть proof.

### 3.1 SoT vs зеркала drift

```sql
SELECT s.id, s.user_id, s.access_end_at, ta.active_until,
  s.access_end_at::date - ta.active_until::date as drift_days
FROM subscriptions_v2 s
JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
JOIN telegram_access ta ON ta.user_id = s.user_id AND ta.club_id = pcm.club_id
WHERE s.status IN ('active','trial')
  AND ta.active_until IS NOT NULL
  AND s.access_end_at::date != ta.active_until::date;
```

### 3.2 Ошибочно removed (по ВСЕМ источникам)

Проверка по subscriptions + entitlements + manual_access + grace/billing-day.

### 3.3 Removed без audit / каким процессом

```sql
SELECT tcm.user_id, tcm.club_id, tcm.access_status, tcm.updated_at,
  al.action, al.actor_label, al.meta,
  CASE WHEN al.id IS NULL THEN 'NO AUDIT' ELSE 'HAS AUDIT' END
FROM telegram_club_members tcm
LEFT JOIN audit_logs al ON al.target_user_id = tcm.user_id
  AND al.action LIKE 'telegram.%'
  AND al.created_at BETWEEN tcm.updated_at - interval '1 min' AND tcm.updated_at + interval '1 min'
WHERE tcm.access_status = 'removed'
ORDER BY tcm.updated_at DESC LIMIT 100;
```

### 3.4 Expired но не kicked

Пользователи с in_chat/in_channel = true, без валидного доступа ни по одному источнику.

### 3.5 Stale reminders

Уведомления, отправленные после фактического продления подписки.

### 3.6 Не тот клуб в уведомлении

```sql
-- Renewal notification vs actual product-club mapping
SELECT tl.user_id, tl.event_type, tl.created_at,
  s.product_id, pcm.club_id as expected_club,
  tl.meta->>'club_id' as notified_club
FROM telegram_logs tl
JOIN subscriptions_v2 s ON s.user_id = tl.user_id AND s.status = 'active'
LEFT JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
WHERE tl.event_type LIKE 'renewal_success%'
  AND tl.created_at > NOW() - interval '30 days'
ORDER BY tl.created_at DESC;
```

---

## Изменяемые файлы


| Файл                                      | Изменение                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `_shared/resolve-effective-access.ts`     | НОВЫЙ: единый helper с полным access snapshot                               |
| `_shared/invite-link-helper.ts`           | НОВЫЙ: общий helper для invite links                                        |
| `_shared/accessValidation.ts`             | Billing-day: timezone unify (после discovery), end-of-day guard             |
| `telegram-grant-access/index.ts`          | activeUntil через resolveEffectiveClubAccess                                |
| `subscription-charge/index.ts`            | Per-club membership check + зеркала по product_id клубам + ссылки в renewal |
| `subscription-grace-reminders/index.ts`   | Сумма по приоритету + реальный продукт + anti-stale по sub.id               |
| `subscription-renewal-reminders/index.ts` | Anti-stale guard по sub.id                                                  |
| `telegram-check-expired/index.ts`         | audit_logs с system actor + shared helper                                   |
| `telegram-revoke-access/index.ts`         | Улучшить DM: причина + клуб                                                 |
| `telegram-kick-violators/index.ts`        | DM при kick (после факта) + shared helper                                   |


## Порядок выполнения

1. **Discovery BEFORE** — запустить диагностику 3.1-3.6, timezone discovery, зафиксировать baseline
2. Создать `_shared/resolve-effective-access.ts`
3. Создать `_shared/invite-link-helper.ts`
4. Привести `accessValidation.ts` к единому timezone + end-of-day (после discovery proof)
5. `subscription-charge`: per-club membership check + согласованные зеркала + ссылки в renewal
6. `telegram-grant-access`: activeUntil через helper
7. `subscription-grace-reminders`: сумма + продукт + anti-stale
8. `subscription-renewal-reminders`: anti-stale guard
9. `telegram-check-expired`: audit_logs + shared helper
10. `telegram-revoke-access` + `telegram-kick-violators`: DM + shared helper
11. **Discovery AFTER** — повторить 3.1-3.6, сравнить before/after

---

## DoD

### Архитектурная согласованность (обязательный proof-пакет)

- Canonical field map зафиксирована и подтверждена
- Read/write matrix по функциям подтверждена
- Timezone discovery proof: единый timezone зафиксирован, расхождений нет
- Одинаковая дата доступа в 3-5 реальных кейсах: UI, notification, kick-check (через единый helper)
- Before/after по SoT vs mirrors drift
- Before/after по silent revoke
- Продукты / тренинги / Telegram реально одна система (training_modules.product_id и access_rules(training_content) не живут отдельно от subscription logic)

### По продлению (Renewal proof)

- При renew НЕ приходит «✅ Доступ открыт!» если пользователь уже в клубе
- Приходит одно уведомление «✅ Подписка продлена!» с inline-кнопками входа
- Ссылки формируются через тот же helper, что и при grant
- Срок доступа = конкретный продукт (через resolveEffectiveProductAccess)
- Зеркала обновлены согласованно: telegram_access.active_until = telegram_access_grants.end_at
- Зеркала обновлены **только по клубам product_id подписки**, не глобально
- Membership state не ломается у already-in-club пользователя
- Пользователь не кикается ошибочно в тот же день после renew

### Multi-club case (renewal)

- Пользователь с двумя клубами, двумя продуктами и разными датами
- Renew продукта 1 меняет только клуб 1
- Renew продукта 2 меняет только клуб 2
- Название клуба, ссылки и дата в уведомлении соответствуют именно нужному клубу
- Другой клуб не затрагивается

### Negative proof по renew

- Renew не создаёт лишний grant (для клубов где user уже member)
- Renew не дублирует сообщение «Доступ открыт»
- Renew не меняет дату доступа на чужую (другой продукт)
- Renew не ломает membership state

### По grace/failure (Grace proof)

- Сумма определяется строго: meta.recurring_amount → tariff_prices → orders_v2 по product_id
- Название продукта из subscriptions_v2.product_id → products_v2.name, не хардкод, не orders_v2
- Grace не стартует, если подписка уже продлена (anti-stale по sub.id)
- Renewal reminder не уходит после продления (anti-stale по sub.id)

### По revoke (Auto-revoke proof)

- При любом auto-revoke есть `audit_logs` с: actor_type='system', actor_user_id=NULL, actor_label=имя процесса, meta.reason_code, meta.reason_text, meta.access_snapshot
- DM отправляется только после фактического успешного revoke/kick
- DM содержит понятную причину и название клуба
- Revoke НЕ происходит при наличии валидного доступа (guard через hasValidAccess)
- telegram-check-expired и telegram-kick-violators вызывают один и тот же shared helper

### Multi-source negative proof по revoke

- Подписка истекла, но entitlement/manual access ещё валиден → revoke/kick не происходит
- Пользователь с валидным доступом не кикается
- Уведомление о revoke не отправляется ошибочно

### По billing-day

- Кик НЕ происходит до конца дня в согласованном timezone если access_end_at = today
- Единый timezone во всех функциях (зафиксирован после discovery)

### По единой дате (invariant proof — SQL/read-only)

- subscriptions_v2.access_end_at = telegram_access.active_until = telegram_access_grants.end_at для одного пользователя/продукта
- Дата в renewal notification = дата в карточке = дата в hasValidAccess
- NULL = бессрочно корректно обрабатывается helper'ом
- Доказано SQL-запросом before/after

### По тренингам/продуктам

- Сроки доступа к тренингу и Telegram-клубу берутся из одного продуктового контура
- training_modules.product_id и access_rules(training_content) не живут отдельно от subscription logic

### Диагностика

- Before/after по каждому из 6 запросов
- Список ошибочно отозванных (по всем источникам)
- Список removed/kicked без audit + каким процессом
- Список expired-but-not-kicked
- Список stale уведомлений
- Проверка «не тот клуб в уведомлении»
- Результат сравнения до/после фиксов

### Финальный отчёт: раздел «Архитектурная согласованность»

- canonical vs derived поля
- read/write matrix
- одинаковая дата в 3-5 кейсах (включая multi-club)
- before/after по drift, silent revoke, stale reminders
- proof единой системы продуктов/тренингов/Telegram