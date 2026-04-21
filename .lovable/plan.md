да, согласен, с учетом правок:

1. **Diagnose-отчёт сделать отдельным обязательным артефактом до Execute.**  
Не просто “проверить”, а зафиксировать в начале отчёта 4 блока:  

  - SQL-1/2: все подписки Ирины + отдельно Gorbova Club;
  - SQL-3: реально отправленный payment_link;
  - SQL-4: живой enum subscription_status;
  - SQL-6: before-response по проблемной ссылке.  
  В конце diagnose-блока должен быть явный вывод:
  - root_cause = guard_only
  - или root_cause = zombie_row
  - или root_cause = stale_ui_state
  - или root_cause = writer_mismatch  
  Без этого к cleanup не переходить.
2. **Path-proof check выделить как отдельный обязательный раздел verify.**  
Нужен не общий текст, а таблица:
  - AdminPaymentLinkDialog
  - PaymentDialog
  - PublicPayPage
  - public-checkout
  - bepaid-create-subscription-checkout
  - _shared/create-payment-checkout  
  Для каждой точки:
  - где считается conflict;
  - использует ли shared helper;
  - есть ли локальный дубль guard-логики;
  - требуется ли правка.  
  public-checkout менять только если в этой таблице реально найден дубль.
3. **Добавить audit for writes во все новые write-ветки.**  
Обязательно зафиксировать audit для:
  - provider_managed replacement;
  - local_only_no_provider_subscription replacement;
  - subscription.zombie_cleanup при точечной санации;
  - отказа replacement из-за mismatch по user_id/product_id/status — хотя бы console + structured log, если не пишется в audit_logs.  
  В итоговом отчёте показать, какие именно action пишутся и в каком месте.
4. **Изменения public-checkout жёстко ограничить.**  
В плане уже написано “только если Diagnose покажет дубль” — это правильно.  
Уточнить явно:
  - если public-checkout только проксирует в _shared/create-payment-checkout, файл не трогаем;
  - никакого рефакторинга “на всякий случай” в public-checkout не делать.
5. **Проверку stale UI-state сделать отдельным обязательным мини-proof до cleanup БД.**  
До любой миграции/санитации показать:
  - переключение same-product → different-product;
  - переключение subscription → one_time;
  - смена тарифа внутри продукта;
  - новый submit после старого conflict.  
  Цель: доказать, что конфликт не “прилип” только на клиенте.  
  Если stale-state подтверждается как первичная причина — сначала фикс UI, потом повторный before/after backend proof, и только потом решать, нужен ли cleanup.
6. **Provider-managed nature проверять не по одному полю, а по объединённому правилу.**  
В helper явно зафиксировать:
  - сначала смотреть subscriptions_v2.provider_subscription_id / bepaid_subscription_id;
  - если пусто — проверять наличие строки в provider_subscriptions;
  - только после этого считать подписку blocker’ом или относить к local-only anomaly.  
  Это нужно прописать прямо в алгоритме helper, не только в тексте плана.
7. **Для cleanup добавить safety-guard на повторный запуск.**  
Если точечная миграция всё же потребуется:
  - обновлять только строки, которые на момент выполнения всё ещё находятся в conflict-status;
  - и всё ещё не имеют provider linkage;
  - и входят в заранее зафиксированный список id.  
  Иначе есть риск задеть уже изменённую вручную запись.
8. **Writer-proof по жалобе сделать before/after не только по SQL, но и по UI-source.**  
Помимо payment_links.product_id/tariff_id, в отчёт включить:
  - что было выбрано в UI;
  - что реально ушло в writer body;
  - что реально сохранилось в payment_links.  
  Это нужно, чтобы закрыть риск selectedProductId -> stale write.
9. **В verify для backend-кейсов добавить expected response shape.**  
Для каждого из 4 сценариев указать:
  - success=true + redirect_url
  - или success=false + error='existing_subscription_conflict' + conflict{...}  
  Чтобы не было размытого “должно пройти”.
10. **Memory update сделать только после фактического исхода.**  
Не заранее.  
В памяти должно быть сохранено одно из двух:
  - guard-fix only
  - guard-fix + zombie-cleanup  
  с явной причиной и, если был cleanup, с перечислением конкретных subscription_id.
11. **В “не трогаем” добавить ещё явно:**
  - payment_links_enriched_v
  - вкладку Платежи/Ссылки
  - consume-payment-link
  - admin-create-public-link / admin-update-payment-link / admin-invalidate-payment-link  
  Чтобы подрядчик не расширил скоуп в сторону уже закрытого спринта по ссылкам.
12. **Финальный verdict оформить строго в двух вариантах.**  
В конце отчёта должен быть один из вариантов:
  - Итог: выполнен только guard-fix, cleanup не потребовался
  - Итог: выполнен guard-fix и точечный zombie-cleanup по id: ...  
  Без расплывчатого “в целом исправлено”.

&nbsp;

&nbsp;

# План: PATCH PAYMENT-CONFLICT v3 — product-level guard + условный cleanup зомби-подписок

## 1. Бизнес-правило (SoT)

```text
Конфликт подписки = same user_id + same product_id
                  + status in (conflict statuses из enum)
                  + provider-managed nature подтверждена
```

Provider-managed nature = (`subscriptions_v2.provider_subscription_id IS NOT NULL`
OR `subscriptions_v2.bepaid_subscription_id IS NOT NULL`
OR существует связанная запись в `provider_subscriptions` для этой `subscription_v2_id`).

- `tariff_id`, `amount`, `price`, `offer.amount` НЕ участвуют в conflict detection.
- Локальные active-записи без provider-связи — это data anomalies, не блокеры.
- Replacement разрешён между разными тарифами одного продукта.

«Подписка» в этом патче = bePaid recurrent subscription (provider-managed).

## 2. Корневая жалоба

Пользователь `iryna.troinich@gmail.com`:

- получила корректную ссылку на Gorbova Club / BUSINESS;
- не имеет действующей bePaid-подписки на Gorbova Club;
- имеет действующую bePaid-подписку на «Бухгалтерия как бизнес» (другой product_id);
- backend возвращает `existing_subscription_conflict` для Gorbova Club.

Возможные причины: устаревший guard (по tariff/цене); зомби-запись в `subscriptions_v2` на Gorbova Club без provider-связи; stale conflict в UI state. Diagnose решит, какая именно.

## 3. Diagnose (READ-ONLY, до Execute)

### SQL-1. Все подписки пользователя с диагностикой mode

```sql
select s.id, s.status, s.product_id, p.name as product_name,
       s.tariff_id, t.name as tariff_name,
       s.provider_subscription_id, s.bepaid_subscription_id,
       (select count(*) from provider_subscriptions ps
         where ps.subscription_v2_id = s.id) as provider_links,
       s.next_charge_at, s.access_end_at, s.created_at, s.updated_at
from subscriptions_v2 s
left join products_v2 p on p.id = s.product_id
left join tariffs t on t.id = s.tariff_id
where s.user_id = (select user_id from profiles
                   where lower(email)='iryna.troinich@gmail.com')
order by s.product_id, s.created_at desc;
```

### SQL-2. Конкретно по Gorbova Club у этого пользователя

```sql
select s.*,
       (select count(*) from provider_subscriptions ps
         where ps.subscription_v2_id = s.id) as provider_links
from subscriptions_v2 s
where s.user_id = :uid
  and s.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616';
```

### SQL-3. Реально отправленный payment_link

```sql
select id, url_token, product_id, tariff_id, payment_type, amount, created_at
from payment_links where user_id = :uid order by created_at desc limit 10;
```

### SQL-4. Enum subscription_status (живой)

```sql
select unnest(enum_range(null::subscription_status));
```

В отчёте явно перечислить:

- conflict statuses (подмножество, реально соответствующее «активной»);
- replacement statuses (подмножество terminal, разрешённое как источник replacement).

### SQL-5. Глобальная оценка зомби (только counts, без id)

```sql
select count(*) from subscriptions_v2 s
where s.status in (:conflict_statuses)
  and s.provider_subscription_id is null
  and s.bepaid_subscription_id is null
  and not exists (select 1 from provider_subscriptions ps
                  where ps.subscription_v2_id = s.id);
```

### SQL-6. Before-proof по ссылке из жалобы

- зафиксировать `payment_link.product_id`, `tariff_id`;
- через `supabase--curl_edge_functions` вызвать `public-checkout` с этим токеном и сохранить точный JSON-ответ (текущий `existing_subscription_conflict`).

### Static grep

- `existing_subscription_conflict`
- `checkSubscriptionConflict` / любые локальные дубли guard-логики
- `tariff_id` в conflict-контексте
- `amount` / `price` / `offer.amount` рядом с conflict
- проверить, есть ли в `public-checkout/index.ts` собственная conflict-логика — если нет, файл НЕ трогаем

## 4. Изменения

### A. Backend — единый product-level + provider-aware guard

`**supabase/functions/_shared/subscription-conflict.ts**` (переписать существующий, без второго helper)

Mapping:

- было: `.eq('user_id').eq('product_id').eq('tariff_id')` + расширенный список статусов
- стало: `.eq('user_id').eq('product_id').in('status', :conflict_statuses)`
  - AND provider-managed nature (через select с join на `provider_subscriptions` либо двухшаговым запросом)

Replacement validation:

- оставить: `oldSub.user_id === user_id`, `oldSub.product_id === product_id`, `oldSub.status in :replacement_statuses`
- убрать: `oldSub.tariff_id === new_tariff_id`
- `:replacement_statuses` — строго из SQL-4

Response `conflict` сохраняет: `tariff_id`, `provider_subscription_id`, `bepaid_subscription_id`, `next_charge_at`, `access_end_at` — для UI и replacement.

### B. Backend entrypoints

- `supabase/functions/_shared/create-payment-checkout.ts` — использует обновлённый helper.
- `supabase/functions/bepaid-create-subscription-checkout/index.ts` — использует тот же helper, без локальных дублей.
- `supabase/functions/public-checkout/index.ts` — **только если Diagnose покажет локальную conflict-логику**, иначе не трогаем.

### C. Replacement helper

`**src/lib/subscriptionReplacement.ts**`

Два явных режима:

- `provider_managed`: provider-связь подтверждена (id в `subscriptions_v2` или запись в `provider_subscriptions`) → `bepaid-cancel-subscriptions` обязателен; failure → STOP, ошибка пользователю; затем `superseded`.
- `local_only_no_provider_subscription`: разрешён **только** если Diagnose / runtime-check подтвердил отсутствие provider id И отсутствие записи в `provider_subscriptions` → без provider cancel, `status='superseded'`, `auto_renew=false`, audit с явным режимом.

Никакого silent fallback. Режим виден в audit_logs.

### D. UI — product-level guards + wording

`**AdminPaymentLinkDialog.tsx**`, `**PaymentDialog.tsx**`, `**PublicPayPage.tsx**`:

- `isCurrentConflict(conflict, selectedProductId, paymentType)` = `conflict.product_id === selectedProductId && paymentType === 'subscription'`.
- Убрать `conflict.tariff_id === selectedTariffId` из render / disable / confirm / stale guards.
- Wording: «У вас уже есть активная подписка на этот продукт» + строки «Текущий тариф: …» / «Новый тариф: …».
- При смене продукта/тарифа/типа оплаты и перед каждым submit — сброс stale `conflictData`.
- При переключении на разовую оплату conflict UI исчезает полностью.

### E. Условный cleanup зомби-подписок (создаётся ТОЛЬКО если SQL-2 показал зомби)

Если SQL-2/SQL-5 для пользователя выявит зомби-записи на Gorbova Club без provider-связи — создаётся **точечная** миграция по конкретному списку id:

```sql
update subscriptions_v2
set status='superseded', auto_renew=false, updated_at=now()
where id in (:zombie_ids);
insert into audit_logs (action, meta, ...)
values ('subscription.zombie_cleanup',
        '{"cleanup_reason":"active_without_provider_subscription", "ids":[...]}', ...);
```

- Никакого массового UPDATE.
- Не использовать `replacement_mode` — это техническая санация, отдельное событие.
- Если зомби нет — миграция не создаётся, проблема решается только guard-фиксом.

### F. Memory

Обновить `mem://commercial-logic/subscriptions/duplicate-subscription-prevention-guard`:

- conflict = `user_id + product_id`;
- tariff и price игнорируются;
- блокирует только provider-managed subscription (provider id в `subscriptions_v2` или запись в `provider_subscriptions`);
- local-only active rows без provider-связи — data anomalies, подлежат точечной санации, не блокируют оплату;
- replacement разрешён между тарифами одного продукта.

## 5. Файлы


| Файл                                                              | Изменение                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `supabase/functions/_shared/subscription-conflict.ts`             | product-level + provider-aware guard, replacement без tariff |
| `supabase/functions/_shared/create-payment-checkout.ts`           | использует обновлённый helper                                |
| `supabase/functions/bepaid-create-subscription-checkout/index.ts` | использует helper                                            |
| `supabase/functions/public-checkout/index.ts`                     | **только если Diagnose обнаружит локальный дубль guard**     |
| `src/lib/subscriptionReplacement.ts`                              | provider_managed vs local_only с подтверждением              |
| `src/components/admin/AdminPaymentLinkDialog.tsx`                 | product-level guard, wording                                 |
| `src/components/payment/PaymentDialog.tsx`                        | то же                                                        |
| `src/pages/PublicPayPage.tsx`                                     | то же                                                        |
| миграция                                                          | **создаётся условно** — только при подтверждённых зомби-id   |
| memory                                                            | duplicate-subscription-prevention-guard v3                   |


## 6. Не трогаем

- схемы `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payment_links`;
- RLS, enum, триггеры;
- `grant-access-for-order`, webhook fulfillment;
- `admin-create-public-link`, `admin-create-payment-link` writers;
- `consume-payment-link`;
- site/public payment link writers;
- Telegram, table-shell, дизайн, `/admin/live-events`.

## 7. Verify (4 сценария + path + writer + replacement + cleanup)

**Backend кейсы:**

1. different product + same price → нет конфликта.
2. same product + same tariff → конфликт.
3. same product + different tariff → конфликт.
4. local-only zombie record после cleanup (или после фикса guard, если cleanup не понадобился) → checkout проходит без конфликта.

**Path-proof:**

- public `/pay/:token` (bound + public);
- admin `AdminPaymentLinkDialog`;
- direct `bepaid-create-subscription-checkout`.

**Writer-proof по жалобе (before/after):**

- before: точный JSON ответа `public-checkout` для реальной ссылки Ирины (текущий conflict);
- after: тот же URL → checkout открывается без conflict block;
- SQL подтверждение: `payment_link.product_id` = Gorbova Club / `tariff_id` = BUSINESS.

**Replacement-proof:**

- provider_managed: cancel у провайдера + `superseded` + audit + новая checkout с `replacement_of_subscription_v2_id`;
- local_only: без provider cancel + `superseded` + audit `replacement_mode='local_only_no_provider_subscription'` (только при подтверждённом отсутствии provider-связи).

**Cleanup-proof (условно):**

- список конкретных id зачищенных зомби с записями в `audit_logs` (`action='subscription.zombie_cleanup'`).

**Скриншоты mobile 440×798 (минимум 5):**

1. `/pay/:token` Gorbova Club для Ирины — checkout открывается без conflict block.
2. `/pay/:token` same-product → conflict block с правильным wording.
3. admin same-product → conflict block.
4. admin different-product (same price) → нет conflict block.
5. local-only replacement без ошибки «не удалось отменить у провайдера» (если применимо).

## 8. STOP-guards

- Diagnose покажет, что причина — stale UI state / cached conflict, а не БД → сначала фиксить UI-state bug, не лезть в БД.
- writer mismatch (`selectedProductId` ≠ `payment_links.product_id`) → отдельный фикс writer ПЕРЕД guard-логикой.
- зомби без явного списка id → не делать UPDATE.
- enum не содержит ожидаемого статуса → не использовать вымышленные.
- provider cancel failed для provider_managed → STOP, не создавать новую оплату.
- любой массовый UPDATE/DELETE без явного списка id → STOP.

## 9. DoD

1. Conflict только по `user_id + product_id + status` + подтверждённая provider-managed nature.
2. `tariff_id` и цена нигде не влияют на conflict.
3. Локальные active без provider-связи не блокируют оплату.
4. Conflict statuses и replacement statuses взяты из живого enum и явно перечислены в отчёте.
5. Replacement работает в обоих режимах, режим виден в audit.
6. Writer integrity подтверждена SQL-ом по жалобе.
7. Before/after proof по конкретной ссылке Ирины приложен.
8. Все 4 backend-кейса verify проходят.
9. Memory обновлена.
10. 5 скриншотов приложены.
11. В отчёте явно указан фактический сценарий: «только guard-fix» **или** «guard-fix + точечный zombie-cleanup» (с перечислением id).