# Да, согласен, с учетом правок:

&nbsp;

1. Главный недостающий блок в плане — was_club_member сейчас глобальный на profile, а не per-product / per-club.  
Это значит, что после одного клуба/продукта повышенная цена может включиться и для другого.  
Одного удаления was_club_member = true из telegram-revoke-access недостаточно.  
Нужно обязательно:  

  - перевести reentry pricing на product-scoped state;
  - перестать принимать pricing-решение по глобальному profiles.was_club_member;
  - сделать backfill/repair для уже ошибочно поднятых цен.
2. &nbsp;
3. Повышение цены должно включаться не по факту кика, а только после окончания grace 72h.  
Источник включения reentry pricing — только post-grace событие.  
Membership state (removed, kicked, not_in_chat) не должен сам по себе менять цену.
4. Нужен repair уже испорченных кейсов.  
Если кому-то was_club_member уже выставили раньше времени, надо:  

  - dry-run списка таких пользователей;
  - reset ошибочного reentry state;
  - отдельно показать, у кого цена должна остаться повышенной, а у кого нет.
5. &nbsp;
6. Email stale-reminders нельзя закрывать только code-proof.  
Нужен именно живой proof по email, не только по Telegram:  

  - renewal reminder;
  - grace started / 72h;
  - проверка очереди/журнала отправки;
  - final pre-send recheck по subscription_id, если discovery покажет хотя бы 1 stale-case.
7. &nbsp;
8. Wrong-club / wrong-product proof надо делать не только по логам, а по payload:  

  - subscription_id
  - product_id
  - product_name
  - club_id
  - club_name
  - effective_end_at
  - amount
  - pricing_mode
9. &nbsp;
10. Mirror/backfill и pricing repair — это разные corrective batch-операции, их нельзя смешивать:  

  - batch 1: mirrors
  - batch 2: membership repair
  - batch 3: reentry pricing repair
  - batch 4: corrective notifications
11. &nbsp;
12. Live renewal proof оставить обязательным pending-proof, если в проде ещё не было нового renew event.  
Не закрывать пункт “по логике кода”.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

# PATCH-FINAL-CLEANUP v2 — добивка хвоста по доступам, email, pricing и final proof

&nbsp;

## Жёсткие правила исполнения

- add-only

- ничего не ломать вне scope

- сначала dry-run / discovery / proof, потом execute

- никакого глобального “общего срока по пользователю”

- все решения по сроку доступа — строго per-club / per-product

- все решения по цене — строго per-product

- membership state не является источником цены

- цена повышается только после конца grace 72h

- все batch-операции писать в audit_logs:

  - actor_type='system'

  - actor_user_id=NULL

  - actor_label

  - batch_id

  - meta

- финальный отчет строго на русском

&nbsp;

## Контекст

Уже исправлено и не ломать:

1. resolveEffectiveClubAccess / resolveEffectiveProductAccess

2. invite-link-helper

3. APP_TZ / Minsk в access-critical логике

4. anti-stale guards в renewal/grace reminders

5. per-club membership check в subscription-charge

6. corrective backfill mirrors уже выполнен

7. valid_not_in_chat уже поставлены в grant queue

8. live-sync карточки при открытии = intentionally deprecated

&nbsp;

---

&nbsp;

## PHASE 1 — correction tail

&nbsp;

### 1.1 Mirror missing

Dry-run:

- user_id

- club_id

- effective_end_at

- telegram_access row exists?

- active grant exists?

- membership exists?

- pending/processing queue exists?

- recommended_action

&nbsp;

Execute:

- если membership ок и нет telegram_access row → создать mirror row

- если membership нет и доступ валиден → queue grant

- если ambiguous → manual review

&nbsp;

DoD:

- mirror_missing = 0

&nbsp;

### 1.2 wrongly_removed / valid_not_in_chat tail

Dry-run:

- wrongly_removed

- valid_not_in_chat

- effective_end_at

- valid_source_type

- valid_source_id

- recommended_action = queue_regrant / manual_review

&nbsp;

Execute:

- queue_regrant только если effective_end_at > now + 1 day

- manual_review отдельно сохранить файлом

- idempotency guard: не создавать дубль pending/processing queue row

&nbsp;

DoD:

- wrongly_removed закрыт или вынесен в ручной confirm

- valid_not_in_chat обработан

&nbsp;

### 1.3 Corrective notifications

Собрать affected users:

- old mirror / old visible date

- new effective date

- diff_days

&nbsp;

Разделить:

- extended > 1 day → auto notify

- shortened → manual review only

- minor <= 1 day → no action

&nbsp;

Шаблон auto-notify:

«ℹ️ Уточнён срок доступа к {club_name}. Актуальный срок: до {date} (по Минску).»

&nbsp;

Правила:

- строго per-club

- не объединять несколько клубов в одно сообщение

&nbsp;

DoD:

- auto-notify отправлен

- shortened list сохранён отдельно

&nbsp;

---

&nbsp;

## PHASE 2 — email stale-reminders final proof

&nbsp;

## Цель

Подтвердить, что письма больше не уходят по старым датам после продления.

&nbsp;

### 2.1 Discovery

Собрать живые данные по email:

- subscription_id

- event_type

- sent_at

- current access_end_at

- subscription updated_at

- verdict:

  - valid

  - stale_after_renew

  - grace_after_renew

&nbsp;

Проверить:

- renewal reminders

- grace started

- grace 72h / 24h / expired

- send-email queue / outbox / delivery log

&nbsp;

### 2.2 Если найден stale-case

Добавить final pre-send recheck по `subscription_id` непосредственно перед email send.

Если состояние уже изменилось:

- skip send

- log `skip_reason = stale_after_renew`

&nbsp;

### 2.3 DoD

- stale email reminders after renewal = 0

- stale grace emails after renewal = 0

- в отчёте есть живой proof, не только code-proof

&nbsp;

---

&nbsp;

## PHASE 3 — reentry pricing bug (критично)

&nbsp;

## Диагностика

Сейчас reentry pricing активируется через `profiles.was_club_member`.

Это глобальный profile-level флаг.

Это нарушает per-product isolation.

&nbsp;

Также `telegram-revoke-access` раньше ставил `was_club_member = true` при кике.

Это включало повышенную цену мгновенно.

&nbsp;

## Обязательная архитектурная правка

Перевести reentry pricing на product-scoped state.

&nbsp;

### 3.1 Новый product-scoped источник

Добавить новую сущность/состояние reentry pricing уровня продукта:

пример:

- user_id

- product_id

- reentry_active

- applies_from

- source_subscription_id

- reason_code

- created_at / updated_at

&nbsp;

Никаких решений по цене больше не принимать из `profiles.was_club_member`.

&nbsp;

### 3.2 Источник включения reentry

Reentry pricing активируется только:

- после окончания grace 72h

- по конкретному product_id

- через post-grace transition

&nbsp;

Не активируется:

- при kick

- при removed

- при revoke

- при not_in_chat

&nbsp;

### 3.3 Места чтения цены

Перевести на новый helper / state:

- public-product

- public-product-by-slug

- public-tariff-by-public-id

- payment link / renewal CTA / recovery CTA

- email / telegram price text

- любые recovery / buy-again flows

&nbsp;

### 3.4 Repair already broken reentry cases

Dry-run:

- у кого reentry price активен сейчас

- по какому product_id

- grace ещё идёт или уже закончился

- был ли кик раньше grace end

- должна ли цена быть regular или reentry

&nbsp;

Execute:

- reset ошибочно активированного reentry state

- не трогать legit reentry cases after grace expiration

&nbsp;

### 3.5 STOP-guards

- если не найден единый вход для pricing surfaces → STOP и собрать матрицу источников цены

- если repair затрагивает пользователей без явного product_id → STOP

- если нельзя отделить legacy global flag от product-scoped state → STOP и сначала migration/backfill plan

&nbsp;

### 3.6 DoD

- reentry pricing не включается при kick

- reentry pricing включается только после grace end

- решение по цене строго per-product

- global `profiles.was_club_member` больше не влияет на pricing decision

- ошибочно поднятые цены исправлены

&nbsp;

---

&nbsp;

## PHASE 4 — structured notification meta

&nbsp;

Во все renewal / grace / reminder notifications писать structured meta:

- subscription_id

- product_id

- product_name

- club_id

- club_name

- effective_end_at

- amount

- currency

- pricing_mode

- source = renewal / grace / reminder

&nbsp;

Поверхности:

- renewal success

- grace started / 72h / 24h / expired

- renewal reminders 7/3/1

- corrective notifications

&nbsp;

DoD:

- по каждому уведомлению можно доказать, какой продукт/клуб/срок/цена были использованы

&nbsp;

---

&nbsp;

## PHASE 5 — first live renewal proof

&nbsp;

На первом живом renew event после патча проверить:

1. не отправилось “Доступ открыт!”

2. отправилось только renewal-success

3. ссылки на вход присутствуют

4. product_id / club_id / club_name верные

5. дата в сообщении = effective access

6. telegram_access.active_until = telegram_access_grants.end_at = effectiveEndAt

7. обновился только нужный club_id

8. цена в CTA соответствует pricing_mode

&nbsp;

Если live event пока нет:

- зафиксировать `pending-live-proof`

- не закрывать этот пункт словами “по коду всё ок”

&nbsp;

---

&nbsp;

## PHASE 6 — final architecture proof

&nbsp;

Собрать итоговую матрицу:

| Поверхность | Источник даты | Источник цены | Per-club/per-product isolation | Proof |

&nbsp;

Обязательно включить:

- UI карточка

- Telegram renewal

- Email renewal

- Email grace

- Telegram grace

- revoke / kick

- public pricing endpoints

- payment/recovery links

- training/product access narrative

&nbsp;

Отдельно зафиксировать:

- продукт, тренинг и Telegram — одна система

- срок доступа идёт из product scope

- training_modules.product_id + access_rules(training_content) не живут отдельно от subscription logic

- Telegram клубы маппятся к продуктам через product_club_mappings

- effective access считается per-club/per-product, не глобально

- pricing тоже считается per-product, не глобально

&nbsp;

---

&nbsp;

## Порядок выполнения

&nbsp;

1. Dry-run mirror_missing / wrongly_removed / valid_not_in_chat / corrective notify

2. Execute corrective tail

3. Email stale-reminder live proof

4. Discovery pricing matrix

5. Ввести product-scoped reentry pricing state/helper

6. Перевести все pricing surfaces на него

7. Repair already broken reentry cases

8. Add structured notification meta

9. First live renewal proof

10. Final architecture proof

11. Итоговый отчет: done / manual-review / pending-live-proof

&nbsp;

---

&nbsp;

## Финальный DoD

&nbsp;

- [ ] mirror_missing = 0

- [ ] wrongly_removed закрыт или вынесен в ручной confirm

- [ ] valid_not_in_chat обработан

- [ ] corrective auto-notify отправлен

- [ ] shortened list оформлен отдельно

- [ ] stale email reminders after renewal = 0 (живой proof)

- [ ] stale grace emails after renewal = 0

- [ ] reentry pricing не включается при kick

- [ ] reentry pricing включается только после grace_period_ends_at

- [ ] pricing decision строго per-product, не global profile flag

- [ ] все pricing surfaces используют один helper/state

- [ ] structured meta в уведомлениях заполнена

- [ ] first live renewal proof собран или честно помечен pending-live-proof

- [ ] final architecture proof собран

Что уже сделано и как сейчас ведёт себя система:

&nbsp;

Сейчас система считает доступ не по пользователю в целом, а по каждому клубу отдельно.

Она смотрит на:

&nbsp;

- платную подписку по продукту,
- entitlement по этому же продукту,
- ручной доступ по этому клубу.

&nbsp;

&nbsp;

Из этого считается реальный effective access.

Дальше этот срок должен совпадать в:

&nbsp;

- карточке доступа,
- зеркалах telegram_access / telegram_access_grants,
- уведомлениях,
- revoke / kick.

&nbsp;

&nbsp;

Что уже стало лучше:

&nbsp;

- больше нет логики “берём самый дальний срок вообще из всех подписок пользователя”;
- клубы между собой не должны смешиваться;
- cutoff на кик теперь до конца дня по Минску;
- stale-reminders на уровне кода уже защищены recheck-guard’ами;
- зеркала уже подтянуты почти полностью к реальным срокам;
- valid_not_in_chat отправлены на повторную выдачу;
- bePaid timezone-ошибка исправлена.

&nbsp;

&nbsp;

Что ещё не закрыто до конца:

&nbsp;

- финальный живой proof по email;
- окончательная правка reentry pricing, потому что это сейчас самый опасный хвост;
- финальный live-proof первого renew события;
- добивка manual review кейсов.

&nbsp;

&nbsp;

Если хочешь, следующим сообщением я сразу сожму это в короткий PATCH-лист без длинного ТЗ.

&nbsp;

План: PATCH-FINAL-CLEANUP — добивка хвоста по доступам, уведомлениям и цене после кика

---

## Проблема

После основного патча остаются незакрытые хвосты:

1. `telegram-revoke-access` ставит `was_club_member = true` **сразу при кике**, что мгновенно активирует повышенную цену (`reentry_amount`). По бизнес-правилу повышение цены допустимо только после истечения 72h grace window.
2. 1 mirror_missing, 1 wrongly_removed в manual_review, 29 shortened cases, 8 extended cases требуют финальной обработки.
3. Нет живого proof по email stale-reminders, renewal без дублей, wrong-club payload.
4. Уведомления не содержат self-describing meta (product_id, club_id, club_name, effective_end_at).

---

## Диагностика

### Источники reentry pricing

`was_club_member = true` ставится в **двух** местах:

- `telegram-revoke-access/index.ts:596-601` — **при кике/revoke** → **БАГ**: цена повышается мгновенно
- `subscription-charge/index.ts:578-584` (`markAsExpiredReentry`) — **после grace expires** → корректно, с guard через `hasValidAccess`

`was_club_member` читается в:

- `public-product/index.ts:44-54`
- `public-product-by-slug/index.ts:36-46`
- `public-tariff-by-public-id/index.ts:100-109`

Если `was_club_member = true && !reentry_penalty_waived` → все offers показывают `reentry_amount` вместо `amount`.

### Anti-stale guards

Уже добавлены в `subscription-renewal-reminders` (строка 840) и `subscription-grace-reminders` (строка 346). Перечитывают `subscriptions_v2` перед отправкой. Но живой proof отсутствует.

### Notification meta

Текущие renewal/grace notifications не пишут structured meta (product_id, club_id, club_name, pricing_mode) в `telegram_logs`.

---

## Предлагаемое решение

### PHASE 1 — Corrective хвост (one-off)

**1.1 Mirror missing** — SQL dry-run → execute: создать `telegram_access` row или поставить grant.

**1.2 Manual review** — Собрать 3 таблицы (wrongly_removed, shortened, extended). Extended > 1д → auto-notify per-club. Shortened → manual list. Wrongly_removed → grant queue если срок > now+1d.

### PHASE 2 — Email stale-reminders proof (read-only)

SQL по `telegram_logs` / `email_send_log` после деплоя: найти все reminder/grace события, сверить `sent_at` с `subscriptions_v2.access_end_at` на момент отправки. Если stale = 0 → зафиксировать proof. Если stale > 0 → добавить pre-send recheck.

### PHASE 3 — Цена после кика (code fix)

**Ключевой фикс**: убрать `was_club_member = true` из `telegram-revoke-access/index.ts:596-601`.

Логика:

- Кик / revoke сам по себе НЕ активирует reentry pricing
- `was_club_member = true` ставится ТОЛЬКО в `markAsExpiredReentry` (subscription-charge), то есть только после истечения 72h grace
- `markAsExpiredReentry` уже имеет guard через `hasValidAccess` — не ставит флаг, если у пользователя есть другой валидный доступ

Дополнительно:

- Добавить `reentry_pricing_applies_from` timestamp для аудита (уже ставится в `markAsExpiredReentry:583`)
- Проверить, что `telegram-revoke-access` НЕ ставит `reentry_pricing_applies_from`

### PHASE 4 — Notification meta payload (code fix)

В renewal/grace/reminder notification writers добавить structured meta:

- `subscription_id`, `product_id`, `product_name`, `club_id`, `club_name`, `effective_end_at`, `amount`, `currency`

Затронутые файлы:

- `subscription-charge/index.ts` (renewal success notification block)
- `subscription-grace-reminders/index.ts`
- `subscription-renewal-reminders/index.ts`

### PHASE 5 — Live renewal proof (read-only)

На первом реальном renewal после деплоя проверить:

1. Нет "Доступ открыт" / grant queue для already-in-club
2. Есть renewal-success с корректными ссылками
3. Mirrors обновлены только по нужному club_id
4. Meta содержит правильный product/club

Если событий нет — зафиксировать как pending-live-proof.

---

## Изменяемые файлы


| Файл                                      | Изменение                                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| `telegram-revoke-access/index.ts`         | **Удалить** строки 596-603 (was_club_member=true при кике)      |
| `subscription-charge/index.ts`            | Добавить meta payload в renewal notification block (~1790-1850) |
| `subscription-renewal-reminders/index.ts` | Добавить structured meta в telegram_logs insert                 |
| `subscription-grace-reminders/index.ts`   | Добавить structured meta в telegram_logs insert                 |


### Что НЕ будет изменено

- `resolve-effective-access.ts` — не трогаем
- `accessValidation.ts` — не трогаем
- `timezone.ts` — не трогаем
- `markAsExpiredReentry` в subscription-charge — не трогаем (работает корректно)
- `public-product` / `public-product-by-slug` / `public-tariff-by-public-id` — не трогаем (читают `was_club_member` корректно)

---

## Dry-run

1. SQL: подтвердить, что убирание `was_club_member=true` из revoke не ломает flow — проверить, что `markAsExpiredReentry` ставит этот флаг после grace
2. SQL: mirror_missing dry-run
3. SQL: corrective notification dry-run (extended/shortened/wrongly_removed)
4. SQL: email stale-reminder proof
5. Code review: все поверхности reentry pricing → матрица

## Execute

1. Удалить `was_club_member=true` из `telegram-revoke-access`
2. Добавить notification meta в 3 файла
3. Corrective mirror_missing / wrongly_removed
4. Corrective auto-notify (extended > 1д)
5. Деплой затронутых edge functions

## STOP-guards

- Если `markAsExpiredReentry` НЕ содержит `was_club_member = true` → STOP (нельзя убирать из revoke без замены)
- Если corrective update затрагивает > 50 строк зеркал → STOP
- Если в email proof найдено > 5 stale cases → STOP, расширить scope

---

## DoD

- `was_club_member = true` ставится ТОЛЬКО после grace expires, не при кике
- mirror_missing = 0
- wrongly_removed закрыт или в ручном confirm list
- corrective auto-notify отправлен (extended > 1д)
- shortened cases в отдельном manual review файле
- stale email reminders = 0 (живой proof)
- notification meta содержит product_id, club_id, club_name, effective_end_at
- live renewal proof собран или pending-live-proof зафиксирован
- все batches в audit_logs с actor_label и batch_id

## Риски

- Пользователи, которым `was_club_member` уже ошибочно выставлен при кике до grace — останутся с повышенной ценой. Нужен отдельный repair (сброс `was_club_member` для тех, у кого grace ещё не истёк).
- Если renewal event не произойдёт в ближайшие дни — live proof останется pending.