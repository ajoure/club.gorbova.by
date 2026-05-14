да, согласен, с учетом правок:

1. В начале обязательно переименовать заголовок в строгий формат:  
**План: REPAIR-BEPAID-ACCESS-2026-05 v3**
2. В scope добавить явный **read-only discovery перед любыми UI/repair правками**:
  - сколько всего provider_subscriptions.state='active';
  - сколько из них subscription_v2_id IS NULL;
  - сколько linked к expired/superseded/canceled subscriptions_v2;
  - сколько реально относятся к Gorbova Club;
  - сколько к другим продуктам;
  - отдельный список protected/healthy active, которые нельзя трогать.
3. В backend-части уточнить:  
**нельзя определять “bePaid реально мёртв” только по last_successful_charge older expected_interval × 1.5**, если bePaid API возвращает active.  
Нужно разделить статусы:
  - provider реально canceled/expired → локально cancel;
  - provider active, но локальная подписка expired → сначала cancel у bePaid, потом локально state='canceled';
  - provider API недоступен / ambiguous → STOP, не менять запись.
4. Для Вероники указать точный ожидаемый результат:
  - subscriptions_v2.22576f44-… остается expired, access_end_at=2026-05-11, auto_renew=false;
  - provider_subscriptions.a8999dac-… после execute должен стать state='canceled';
  - provider_subscriptions.subscription_v2_id не привязывать задним числом;
  - Telegram-доступ не восстанавливать;
  - entitlement/subscription не создавать.
5. В UI-части добавить правило:  
если subscriptions_v2.status='expired', то любые данные из provider_[subscriptions.next](http://subscriptions.next)_charge_at являются **техническим desync-сигналом**, а не пользовательским статусом. В клиентском UI они не отображаются.
6. Добавить проверку, что карточка контакта и кабинет пользователя используют один и тот же нормализованный subscription/access view, а не разные фильтры на frontend. Иначе баг повторится в другом месте.
7. В DoD добавить обязательный UI-proof:
  - карточка Вероники в админке: Gorbova Club только как истёкшая до 11.05.2026;
  - кабинет Вероники: нет текста «продлится в июне»;
  - Gorbova Club не отображается активным;
  - «Бухгалтерия как бизнес» не затронута и отображается корректно.
8. В массовом repair добавить лимитированный execute:
  - сначала dry-run;
  - затем execute только по явно подтвержденному списку;
  - батчами;
  - с rollback-proof / before-snapshot в proof-файле.
9. В audit добавить обязательные поля:
  - actor_type='system';
  - actor_user_id=NULL;
  - actor_label;
  - provider_subscription_id;
  - subscription_v2_id;
  - before_state;
  - after_state;
  - bepaid_response_status;
  - repair_batch='REPAIR-BEPAID-ACCESS-2026-05'.
10. В STOP-guards добавить:

- если bePaid cancel API вернул ошибку — не ставить локально canceled, а пометить candidate как failed_to_cancel_provider;
- если найден active local subscription с future access_end_at — не трогать;
- если один provider_sub связан с несколькими локальными сущностями или неясным продуктом — STOP по этой строке.

11. В proof добавить отдельный раздел:

- provider_subscriptions до/после;
- bePaid API response;
- UI before/after по Веронике;
- aggregate count после repair:  
active provider_subscriptions with null/expired local subscription = 0.

12. В финальном отчете требовать отдельную строку:  
**payments_v2, orders_v2, entitlements, subscriptions_v2 access_end_at не изменялись**, кроме локального состояния provider_subscriptions и только по approved candidates.

После этих правок план можно запускать: сначала dry-run, потом точечный кейс Вероники, затем массовый repair только по подтвержденному списку.

&nbsp;

## Контекст по Веронике Матук (уточнение факта)

`user_id=341e6f46-…`, продукт **Gorbova Club** (`11c9f1b8-…`).

- Последняя успешная оплата Gorbova Club: **11.04.2026, 250 BYN** (`order 47d54498-…`, `rebill_materialization`). Покрытие до **11.05.2026**.
- Платёж 05.05.2026 (250 BYN, `1b25d697-…`) — это **«Бухгалтерия как бизнес»**, не клуб.
- Локальная `subscriptions_v2` `22576f44-…` — `status=expired`, `access_end_at=2026-05-11`, `auto_renew=false`. ✅ корректна.
- `provider_subscriptions` `a8999dac-…` (`sbs_b541fac39dd6f089`, master 4854) — `state=active`, `next_charge_at=2026-06-10`, `last_charge_at=NULL`, `subscription_v2_id=NULL`. **Это и есть «зомби»**: bePaid не списал в мае, но локальный кеш не обновлён, а UI читает её и рисует «подписка живая, спишет в июне».
- Майского успешного charge по клубу **нет**. Пользователь подтверждает: не продлеваем, отправит новую ссылку.

## Обновлённый план (REPAIR-BEPAID-ACCESS-2026-05 v3)

Цель: убрать «зомби-подписки» из карточек/кабинетов **массово** и закрыть конкретный кейс Вероники без реанимации.

### Этап 1. UI — никогда не показывать expired подписки как «живые»

Точки правки (frontend only):

1. `**src/components/admin/contact/ContactSubscriptionsTab.tsx**` (и/или соответствующий блок в `ContactDetailSheet.tsx`):
  - Подписки с `status IN ('expired','superseded','canceled')` И `(access_end_at IS NULL OR access_end_at < now())` → выводить в свёрнутом разделе **«Истёкшие подписки»**, а не в основном списке.
  - В основной список попадает только `active`/`trial`/`past_due` с `access_end_at >= now()`.
  - Никакого поля «следующее списание» для подписок с `auto_renew=false` или `status≠active`.
2. `**src/components/purchases/SubscriptionListItem.tsx**` (кабинет пользователя):
  - Если `isExpired || status='superseded'` — карточка серая, badge «Истекла», скрыты `next_charge_at`, скрыт payment_method.
  - Если есть `provider_subscriptions.state='active'`, но локальная `subscriptions_v2.status='expired'` → НЕ показывать «продлится … » (сейчас именно эта рассинхронизация рисует ложный live-статус).
3. **Источник «следующего списания» в UI**: брать только из `subscriptions_v2` (status=active, auto_renew=true), **не** из `provider_subscriptions.next_charge_at` напрямую. `provider_subscriptions` остаётся технической таблицей синхронизации и в UI клиента не светится.

DoD: на тест-кейсе Вероники в её карточке клуба больше не отображается активная подписка / next charge июнь. Видна только запись «Истекла 11.05.2026» в свёрнутом блоке.

### Этап 2. Бэкенд — закрыть «зомби» провайдер-подписки массово

Скоуп: `provider_subscriptions` где

```
state='active'
AND provider='bepaid'
AND (
   subscription_v2_id IS NULL
   OR EXISTS (
      SELECT 1 FROM subscriptions_v2 s
       WHERE s.id = provider_subscriptions.subscription_v2_id
         AND s.status IN ('expired','superseded','canceled')
         AND (s.access_end_at IS NULL OR s.access_end_at < now())
   )
)
```

Для каждой записи:

1. **Pull актуального состояния** через `bepaid-get-subscription-details` (canonical, не прямой DB write).
2. Если bePaid реально мёртв (status в bePaid ≠ active, или `last_successful_charge` старше `expected_interval × 1.5`) — применить логику `INV-22 Desync Resolution`:
  - локально `provider_subscriptions.state='canceled'`, `meta.cancel_reason='inv_zombie_provider_dead_2026_05'`;
  - audit `provider_subscription.cancel.zombie_repair_2026_05` (`actor=system`).
3. Если bePaid действительно ещё активен и должен был списать (как у Вероники: висит active, но не списал) — **не реанимировать** локальную подписку. Вместо этого:
  - `provider_subscriptions.state='canceled'` локально + cancel в bePaid через `bepaid-cancel-subscriptions` (canonical), чтобы провайдер случайно не списал в июне с истёкшей локально записи;
  - audit `provider_subscription.canceled.local_expired_provider_active_2026_05`.
4. Доступ **не восстанавливаем**. Пользователю отправляется новая публичная ссылка вручную (вне этого репэйра).

STOP-guards:

- скоуп считается dry-run, exec только после подтверждения списка;
- не трогаем `provider_subscriptions` где соответствующая `subscriptions_v2.status='active'` И `access_end_at >= now()` (это здоровые);
- не трогаем «Бухгалтерия как бизнес» Вероники (`052126fb-…`) — там всё ок;
- не трогаем `payments_v2`/`orders_v2`;
- никаких ручных INSERT в `entitlements`/`subscriptions_v2`.

### Этап 3. Конкретно по Веронике (частный случай этапа 2)

- `provider_subscriptions.a8999dac-…` (`sbs_b541fac39dd6f089`) → cancel в bePaid + локально `state='canceled'`, audit `inv_zombie_provider_dead_2026_05` / `local_expired_provider_active_2026_05` (зависит от ответа bePaid pull).
- Локальная `subscriptions_v2.22576f44-…` остаётся `expired` без изменений.
- Доступ в Telegram-клуб не восстанавливается (его и не должно быть — оплаты в мае не было).
- После cancel — отправить новую public payment link (вне автоматизации).

### Этап 4. Dry-run отчёт (до execute)

`/.lovable/proofs/inv_zombie_provider_subs_2026_05.md`:

- список кандидатов (id, user, product, provider_sub_id, local sub status, expected action);
- ожидаемый rowcount;
- явное упоминание кейса Вероники.

### Этап 5. Verify после execute

- Счётчик `provider_subscriptions WHERE state='active' AND (subscription_v2_id IS NULL OR linked sub expired)` = 0.
- В карточке Вероники Gorbova Club не показывается как активная.
- Audit_logs содержат по записи на каждое изменение.
- Никаких изменений у «здоровых» active подписок.

### Не входит в scope

- UI «свёрнутые сделки» (отложено, к этому кейсу не относится).
- Реанимация expired подписок.
- Изменения в `payments_v2`/`orders_v2`/`entitlements` напрямую.
- Бухгалтерия как бизнес (цепочка цела).
- bePaid webhook логика (только consumers).

### Файлы (предполагаемые правки)

- `src/components/admin/contact/ContactSubscriptionsTab.tsx` — фильтр expired в свёрнутый блок.
- `src/components/admin/ContactDetailSheet.tsx` — выборка/проп сабов.
- `src/components/purchases/SubscriptionListItem.tsx` — скрыть next_charge для не-active.
- `src/hooks/useUserSubscriptions*.ts` (или эквивалент) — НЕ читать `provider_subscriptions.next_charge_at` для UI «продлится».
- Edge / SQL: новый dry-run скрипт + repair через `bepaid-cancel-subscriptions` (canonical), без новых таблиц.
- Proof: `/.lovable/proofs/inv_zombie_provider_subs_2026_05.md`.

Подтверди — и я перехожу в build-режим: сначала dry-run отчёт со списком, затем UI-патчи + точечный repair Вероники, затем массовый repair.