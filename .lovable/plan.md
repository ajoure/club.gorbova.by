да, согласен, с учетом правок:

1. Перед ремонтом сделать pull-state через bepaid-get-subscription-details по всем 5 provider_subscription_id.
2. Если bePaid подтверждает expired/redirecting без успешных списаний:
  - subscriptions_[v2.auto](http://v2.auto)_renew=false;
  - subscriptions_v2.status='canceled' или expired — выбрать по текущему enum/правилу;
  - provider_subscriptions.state оставить как provider-state, не переписывать искусственно;
  - audit [inv22.repair](http://inv22.repair)_provider_dead_local_active.
3. Не отзывать Telegram-доступ автоматически. Это отдельное решение, потому что access_end_at ещё в будущем.
4. Добавить dry-run → execute:
  - dry-run показывает 5 записей и planned updates;
  - execute только после подтверждения.
5. После execute:

-- INV-22 должен вернуть 0

SELECT count(*)

FROM subscriptions_v2 s

JOIN provider_subscriptions ps ON ps.subscription_v2_id = [s.id](http://s.id)

WHERE s.status='active'

  AND [s.auto](http://s.auto)_renew=true

  AND s.access_end_at > now()

  AND (

    ps.state IN ('expired','redirecting')

    OR (ps.state='active' AND [ps.next](http://ps.next)_charge_at IS NULL AND ps.last_charge_at IS NULL)

  );

Можно выполнять как отдельный repair patch.

&nbsp;

План: разбор INV-22 (5 рассинхронизированных подписок)

## Diagnose (что показал отчёт)

INV-22 — это **не мусор**, в отличие от INV-20. Это валидные «зомби-подписки»: в нашей БД они стоят активными и продлеваемыми, а на стороне bePaid их фактически нет.

Все 5 случаев — один и тот же продукт (клуб, `product_id = 11c9f1b8…`) и один и тот же паттерн:

```text
                  bePaid (provider_subscriptions)   |  Наша БД (subscriptions_v2)
sub #1  sbs_de50…  state=expired,    last=NULL      |  active, auto_renew=true, end=2026-05-02
sub #2  sbs_6005…  state=expired,    last=NULL      |  active, auto_renew=true, end=2026-05-11
sub #3  sbs_8381…  state=expired,    last=NULL      |  active, auto_renew=true, end=2026-05-17
sub #4  sbs_9e59…  state=redirecting,last=NULL      |  active, auto_renew=true, end=2026-05-27
sub #5  sbs_c67b…  state=redirecting,last=NULL      |  active, auto_renew=true, end=2026-06-22
```

Что произошло на самом деле:

- У всех 5 `last_charge_at = NULL` — **первичная оплата так и не прошла** (3DS застрял или провайдер закрыл pending).
- Запись в `subscriptions_v2` была создана авансом (под checkout) и осталась висеть со `status=active`.
- Пользователю в кабинете показывается «всё ок, продлится автоматически», хотя bePaid эту подписку давно похоронил.

Это и есть та «реальная ситуация», которая должна приходить в ежедневный отчёт — её нельзя глушить.

## Решение

Сделать INV-22 не только сигналом, но и channel'ом для разбора: показать в отчёте конкретику и дать безопасный one-click ремонт. Дублей не плодим — используем уже существующие канонические writer'ы.

### 1. Расширить отчёт INV-22 (полезный диагноз вместо «5 шт.»)

Файл: `supabase/functions/nightly-payments-invariants/index.ts`.

Сейчас в Telegram уходит безликое `5 активных подписок десинхронизированы`. Добавить в сообщение:

- разбивку по причинам: `expired (N)`, `redirecting (N)`, `active без дат (N)`;
- признак «никогда не было успешного списания» (`ps.last_charge_at IS NULL`) — это «мёртвые при рождении»;
- первые 3 sample строкой `product=… user=… ps_state=… created=…` (не только `sub_id`).

Для этого расширить RPC `inv22_subscription_desync`: добавить в payload поля `bucket` (`never_charged_expired` / `never_charged_redirecting` / `active_no_dates`) и агрегат `by_bucket`.

### 2. Канонический REPAIR без новых функций

Никаких новых writer-функций. Используем существующие:


| Кейс bePaid                                      | Действие на нашей стороне                                                                                                                                                                                                               | Чем закрываем                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ps.state = 'expired'`, `last_charge_at IS NULL` | Подписка never-charged → закрыть как `expired_reentry` (без revoke доступа, доступа и не было, но и `auto_renew=false`, чтобы перестало числиться в зомби)                                                                              | через `bepaid-cancel-subscriptions` (already exists) с reason `inv22_provider_expired` |
| `ps.state = 'redirecting'`, возраст ≥ 48ч        | То же самое: 3DS не дойдёт, считаем мёртвым                                                                                                                                                                                             | то же                                                                                  |
| `ps.state = 'active'`, обе даты NULL             | Сначала pull через `bepaid-get-subscription-details` — возможно у нас просто устарел snapshot. Если bePaid возвращает active+next_charge_at — обновляем `provider_subscriptions`. Если bePaid возвращает terminal — закрываем как выше. | `bepaid-get-subscription-details` → потом тот же путь                                  |


Минимальная защита: **не трогать** записи моложе 48 ч (см. memory `revoke-race-condition-guard`) — `redirecting` свежее 48 ч может ещё дойти.

### 3. UI для ручного разбора

Страница `/admin/system-health` уже умеет показывать invariants. Для INV-22 добавить в `OwnerProblemCard` (или его аналог в `AdminSystemHealth`) action-кнопку «Разобрать INV-22» с двумя шагами:

1. **Dry-run** — вызывает новый thin-endpoint `system-health-inv22-plan` (read-only): возвращает табличку «что собираемся сделать с каждой из 5 подписок».
2. **Execute** — после явного подтверждения вызывает `system-health-inv22-resolve`, который для каждой записи делегирует в `bepaid-get-subscription-details` или `bepaid-cancel-subscriptions`. Никаких прямых UPDATE в `subscriptions_v2`/`provider_subscriptions` — всё через канонические writer'ы.

Оба endpoint'а пишут аудит в `audit_logs`:

- `inv22.plan.viewed` (actor = JWT super_admin)
- `inv22.resolve.applied` (per-subscription, c `before_state` / `after_state` / `delegated_to`)

### 4. Поднять INV-22 в classification

Сейчас INV-22 в humanizer не упомянут, поэтому попадает в fallback `tech_info`. Добавить в `src/lib/system-health/invariant-humanize.ts` маппинг:

- `INV-22` → `problem_type='critical_fix'`, `recommended_action='fix_via_lovable'`
- `whyNotAutofixed`: «Затрагивает живые карты пользователей — нужна явная кнопка владельца»
- `consequenceOfInaction`: «UI показывает пользователям ложное «активна, продлится», провайдер уже не спишет»
- Связанный раздел: `/admin/subscriptions-v2`

### 5. Memory

Записать в `mem://commercial-logic/subscriptions/inv22-desync-resolution`:

- определение «зомби-подписки» = `subv2.active+auto_renew && ps.state in (expired, redirecting) || (active && both dates NULL)`;
- buckets и решение по каждому;
- 48-часовой grace для `redirecting`;
- запрет прямых UPDATE — только через `bepaid-cancel-subscriptions` / `bepaid-get-subscription-details`;
- INV-22 — `critical_fix`, не глушить никогда.

## Технические детали

**Файлы, которые меняются:**

- миграция: новая версия `inv22_subscription_desync` с buckets
- `supabase/functions/nightly-payments-invariants/index.ts` — текст алерта с разбивкой
- `supabase/functions/system-health-inv22-plan/index.ts` — новый, read-only
- `supabase/functions/system-health-inv22-resolve/index.ts` — новый, делегирует в существующие writer'ы
- `src/lib/system-health/invariant-humanize.ts` — INV-22 → critical_fix
- `src/components/admin/system-health/owner/OwnerProblemCard.tsx` — кнопка action для INV-22
- `mem://commercial-logic/subscriptions/inv22-desync-resolution` + апдейт `mem://index.md`

**Что не трогаем:**

- `bepaid-cancel-subscriptions`, `bepaid-get-subscription-details`, `subscriptions-reconcile`, `bepaid-webhook` — существующий канон.
- Прямых SQL-апдейтов по `subscriptions_v2` / `provider_subscriptions` нигде нет (см. memory `canonical-write-path-standard`).

## DoD

1. `inv22_subscription_desync` возвращает buckets, и в Telegram приходит человеческое сообщение с разбивкой по 5 текущим записям.
2. На `/admin/system-health` INV-22 виден как `critical_fix` с кнопкой «Разобрать».
3. Dry-run показывает план по каждой из 5 подписок (что закрыть, что pull-ить).
4. После Execute: либо bePaid подтверждает active и provider_subscriptions обновляется, либо подписка переводится в `expired_reentry` через `bepaid-cancel-subscriptions`, `auto_renew=false`. Доступ не дёргаем (его не было).
5. Повторный запуск INV-22 возвращает `count=0` (или меньшее число с обоснованием по каждой оставшейся).
6. Аудит записан: `inv22.resolve.applied` per subscription с before/after.