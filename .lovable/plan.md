&nbsp;

да, согласен, с учетом правок:

1. План правильный: автосписание bePaid нельзя считать “сломавшимся” из-за удаления/отзыва локального доступа.

&nbsp;

2. В карточке контакта нужно разделить 2 независимые вещи:

&nbsp;

- provider_subscriptions = живая платежная подписка bePaid;

- subscriptions_v2 / entitlements = локальные доступы на платформе.

&nbsp;

Удаление доступа, сделки или локальной подписки не должно переводить bePaid-подписку в “ремонт”.

&nbsp;

3. `isHealthyProviderSub` должен смотреть только на provider-состояние:

state IN ('active','trial','pending')

&nbsp;

Без проверки:

- subscriptions_v2.status;

- subscriptions_v2.access_end_at;

- entitlements;

- orders_v2.

&nbsp;

4. Блок “Технические записи провайдера / ремонт” показывать только при доказанном provider-dead:

- provider_snapshot.state IN canceled/expired/terminated/finished/failed;

- last_pull.http_status = 404;

- inv22_provider_dead_local_active = true.

&nbsp;

5. Кнопка “Ремонт” не должна появляться из-за локально удалённого доступа.

&nbsp;

6. Перед правкой обязательно проверить, что нет второго места в UI, где provider_subscriptions повторно фильтруются через subscriptions_v2/access_end_at.

&nbsp;

7. `admin-repair-zombie-provider-subs` не менять и не удалять.

Меняется только условие, когда карточка контакта предлагает этот repair.

&nbsp;

8. После фикса проверить 3 сценария:

&nbsp;

A. bePaid active + доступ удалён:

- подписка остаётся в обычном блоке “Подписки”;

- кнопки “Ремонт” нет.

&nbsp;

B. bePaid реально canceled/404:

- подписка попадает в “Технические записи”;

- repair доступен.

&nbsp;

C. Повторная выдача доступа:

- не требуется ремонтировать bePaid;

- provider-subscription не исчезает из карточки.

&nbsp;

9. В proof добавить:

- before/after скрин карточки контакта;

- SQL по provider_subscriptions/subscriptions_v2;

- подтверждение, что write-path не тронут:

  grant-access-for-order, bepaid-webhook, subscriptions_v2, entitlements, orders_v2, payments_v2 — без изменений.

Итог: чинить точечно **только UI-классификацию provider-подписки в карточке контакта**. Автосписание bePaid должно жить независимо от локальных доступов.

## Discovery

**Где живёт баг (карточка контакта в админке):**
`src/components/admin/ContactDetailSheet.tsx` строки 2108–2351 — секция «Подписки» / «Технические записи провайдера».

Загружает `provider_subscriptions` join `subscriptions_v2` (строки 739–765, query `contact-provider-subscriptions`) и фильтрует через локальный хелпер `isHealthyProviderSub` (2116–2122):

```text
healthy = subscriptions_v2 EXISTS
       AND subscriptions_v2.status = 'active'
       AND subscriptions_v2.access_end_at >= now()
```

**Почему это даёт описанное поведение:**

- При удалении/отзыве доступа админ-флоу переводит `subscriptions_v2.status` в `expired/canceled/superseded` ИЛИ обнуляет `access_end_at`.
- bePaid-подписка в `provider_subscriptions` остаётся **жива** (`state='active'`, real auto-renewal в bePaid тоже жива), но UI перестаёт считать её healthy → она перетекает в карточку «Технические записи провайдера — требуют ремонта» с кнопкой **«Ремонт»**.
- Кнопка зовёт `admin-repair-zombie-provider-subs` (`supabase/functions/admin-repair-zombie-provider-subs/index.ts`), который при `provider_state='active'` идёт в bePaid `/v2/subscriptions/{id}/cancel` → **реально отменяет автосписание у провайдера**. После этого подписка действительно мёртвая и в карточке уже не появится.

**Эталон (как должно быть) — вкладка «Профиль»:** `src/pages/settings/PaymentMethods.tsx` строки 194–218 показывает все `provider_subscriptions` пользователя по `state IN ('active','trial')` **без** оглядки на `subscriptions_v2.status/access_end_at`. Никакого «зомби-режима» там нет.

**Чего трогать НЕЛЬЗЯ (контракты сохранить 1:1):**

- `grant-access-for-order`, `bepaid-webhook`, `subscription-charge`, любые write-path по доступам и подпискам.
- `subscriptions_v2`, `entitlements`, `orders_v2`, `payments_v2` — никаких миграций данных и схемы.
- Логика «настоящих зомби»: когда **сам провайдер мёртв** (bePaid вернул canceled/expired/terminated/404) — карточка ремонта должна оставаться (это INV-22 кейс).
- Cron `bepaid-subscription-audit-cron`, INV-22 detector — без изменений.
- Edge функция `admin-repair-zombie-provider-subs` — НЕ удаляем (используется и из INV-22 списка `/admin/payments/bepaid-subscriptions`), только перестаём звать из карточки контакта на основе локальных доступов.

## План правки (минимальный, только UI карточки контакта)

Файл: `src/components/admin/ContactDetailSheet.tsx`

1. Переопределить `isHealthyProviderSub` (≈ строки 2116–2124) так, чтобы здоровье считалось **только по самой provider-подписке**, независимо от локальных доступов:
  ```text
   healthy = provider_subscriptions.state IN ('active','trial','pending')
  ```
   Никаких проверок `subscriptions_v2.status` и `access_end_at`.
2. Карточку «Технические записи провайдера — требуют ремонта» (2301–2348) оставить, но триггер сузить до **реальной зомби-сигнатуры провайдера**, согласованной с `admin-repair-zombie-provider-subs`:
  ```text
   zombie = state='active' AND provider='bepaid'
            AND (meta.provider_snapshot.state IN ('canceled','expired','terminated','finished','failed')
                 OR meta.last_pull.http_status = 404
                 OR meta.inv22_provider_dead_local_active = true)
  ```
   То есть карточка ремонта появляется ТОЛЬКО когда провайдер реально мёртв (это уже отмечено INV-22-резолюцией в `meta`). Локальный `subscriptions_v2.status`/`access_end_at` из условия удаляется полностью.
3. Текст подсказки в зомби-карточке переписать: убрать формулировку «привязанная локальная подписка истекла/отменена», заменить на «bePaid сообщил, что подписка отменена/недоступна на стороне провайдера».
4. Display-блок «Подписки» (2127–2300) рендерит provider-подписку как живую вне зависимости от состояния доступов. Поле `accessEnd` (2151–2154) оставляем как есть — оно уже умеет fallback на `meta.provider_snapshot.active_to`, так что при отсутствии sv2/доступа дата следующего цикла всё равно отображается.
5. Auto-sync эффект (строки 832–848) — оставить как есть; он только подтягивает свежий снапшот из bePaid и не выполняет destructive действий.

**Что НЕ меняется:**

- Сам компонент `repairZombieMutation` и edge `admin-repair-zombie-provider-subs` — без правок.
- Список INV-22 на `/admin/payments/bepaid-subscriptions` — без правок (там своя логика).
- Никаких изменений в БД, RPC, миграциях, cron, write-path.

## Dry run (что проверить перед/после фикса в режиме чтения)

SQL (read-only) на контакте, у которого «отвалилось»:

```sql
select ps.id, ps.state, ps.provider_subscription_id,
       sv2.status as sv2_status, sv2.access_end_at,
       ps.meta->'provider_snapshot'->>'state' as provider_state,
       ps.meta->'last_pull'->>'http_status' as last_http,
       ps.meta->>'inv22_provider_dead_local_active' as inv22_flag
from provider_subscriptions ps
left join subscriptions_v2 sv2 on sv2.id = ps.subscription_v2_id
where ps.user_id = '<uid>'
order by ps.created_at desc;
```

Ожидание: `ps.state='active'`, `provider_state='active'`/null, `inv22_flag` отсутствует — после фикса такая запись попадает в healthy-блок, а не в зомби.

## DoD

- В карточке контакта удаление/отзыв доступа или удаление сделки **не** переводит bePaid-подписку в «технические записи / ремонт». Подписка продолжает отображаться как живая, с next_charge и суммой, как во вкладке «Профиль».
- Карточка «требуют ремонта» появляется только когда провайдер реально мёртв (canceled/expired/terminated/404 в `meta.provider_snapshot` или INV-22 флаг).
- Повторная выдача доступа не требует никаких действий с подпиской — она и не исчезала.
- Edge `admin-repair-zombie-provider-subs`, `bepaid-webhook`, `grant-access-for-order`, БД-схема и RLS — без изменений.
- Proof: `.lovable/proofs/contact_provider_sub_visibility_fix_2026_05.md` с before/after скриншотом карточки и фрагментом SQL по подопытному контакту.