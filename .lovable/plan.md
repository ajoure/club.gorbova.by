# Да, согласен, с учетом правок:

&nbsp;

1. **PATCH A** зафиксируй жёстче:
  &nbsp;
  - восстанавливать status = active только если одновременно:
    &nbsp;
    - billing_type = 'provider_managed'
    - текущий status IN ('expired','past_due')
    - access_end_at > now()
    &nbsp;
  - auto_renew = true восстанавливать только для provider_managed
  - cancelled / revoked / superseded не трогать ни при каких условиях
  - в аудит обязательно писать previous_status, new_status, previous_auto_renew, new_auto_renew, subscription_v2_id, provider_subscription_id
  &nbsp;
2. **PATCH C** дополни обязательным аудитом.
  Сейчас это не “желательно”, а обязательно:
  &nbsp;
  - action: subscription.status_manual_fix
  - entity_type: subscription
  - entity_id: e4908f2f-f4c0-42bc-92d7-94ea6c3b22f1
  - target_user_id: 13c0235b-9a2f-4442-bf17-cfde7bfd8f85
  - meta: { previous_status: 'expired', new_status: 'active', previous_auto_renew: false, new_auto_renew: true, reason: 'provider_managed access_end_at in future' }
  &nbsp;
3. По **PATCH B** уточни границы, чтобы подрядчик снова не начал изобретать новое:
  &nbsp;
  - в этом патче **не делать edit для entitlements**, если нет доказанного стандартного action-path;
  - разрешить только **delete** для entitlement-карточек;
  - delete должен удалять только запись из entitlements, без касания orders/payments/subscriptions;
  - в аудит удаления добавить не только product_name, но и product_id, entitlement_id, source_type, order_id, если он есть.
  &nbsp;
4. В плане явно напиши, что **основной баг Дианы должен исчезнуть уже после PATCH A + PATCH C**, потому что запись снова станет обычной активной подпиской и будет рендериться стандартной карточкой.
  То есть:
  &nbsp;
  - entitlement-карточка Дианы должна скрыться дедупом;
  - не нужно пытаться “чинить Диану” через entitlement UI.
  &nbsp;
5. Вынеси отдельно **две разные задачи**, чтобы их не смешали:
  &nbsp;
  - **задача 1:** баг статуса подписки при продлении provider_managed;
  - **задача 2:** parity действий для entitlement-карточек.
    Сейчас они связаны в одном документе, но это разные root cause.
  &nbsp;
6. По **PATCH D** уточни ожидаемое поведение:
  &nbsp;
  - для provider_managed показывать только информативный статус автопродления;
  - toggle MIT не просто “скрыт”, а **недоступен как управляющий элемент**;
  - источник истины для текста “Автопродление включено/выключено” — наличие активной provider-managed подписки, а не MIT-флаг.
  &nbsp;
7. Добавь отдельный **browser-proof checklist по Диане**:
  &nbsp;
  - в активных есть карточка подписки CHAT;
  - у карточки есть ✏️ и 🗑️;
  - виден Telegram-блок;
  - entitlement по тому же продукту отдельно не показывается;
  - в завершённых нет ложной карточки CHAT;
  - автопродление отображается как информативный bePaid-статус без toggle.
  &nbsp;
8. Добавь отдельный **regression checklist по Казачек**:
  &nbsp;
  - активная BUSINESS подписка по-прежнему в активных;
  - кнопки ✏️ и 🗑️ остались;
  - Telegram-блок не пропал;
  - информативный bePaid-бейдж не ломает стандартный рендер;
  - entitlement не дублируется поверх активной подписки.
  &nbsp;
9. По второму кейсу dea78a37 зафиксируй, что это **тот же баг-класс**, а не отдельная аномалия.
  Но execute по нему не делать без отдельного подтверждения.
  В отчёте должен быть отдельный блок:
  &nbsp;
  - subscription_id
  - user_id
  - product_id
  - tariff_id
  - access_end_at
  - почему кейс не фиксили автоматически.
  &nbsp;
10. В handleDeleteEntitlement добавь safeguard:
  &nbsp;
  - удаление только после confirm;
  - блокировка повторного клика на время запроса;
  - после delete обязательный invalidateQueries не только entitlements, но и карточки контакта целиком, если она кэшируется отдельно.
  &nbsp;
11. В плане отдельно пропиши, что **никаких новых диалогов, новых карточек, новых CRUD-механизмов и новых сущностей** в этом патче не создаётся.
  Подрядчик должен использовать только:
  &nbsp;
  - текущую карточку подписки;
  - текущий шаблон entitlement-карточки;
  - текущий delete pattern;
  - текущий audit pattern.
  &nbsp;
12. Добавь в DoD ещё один пункт:
  &nbsp;
  - после фикса у Дианы тип отображения меняется именно на **subscription-card**, а не остаётся entitlement-card.
    Это важный визуальный proof того, что исправлен root cause, а не замаскирован симптом.
  &nbsp;
13. И ещё одно уточнение в конец плана:
  &nbsp;
  - **PATCH E про дубли подписок не выполнять в этом спринте**;
  - только сохранить как отдельный follow-up patch с собственным discovery и proof по кейсу Казачек.
  &nbsp;
14. Итоговую формулировку для подрядчика сделай жёсткой:
  &nbsp;
  - сначала выполнить PATCH A + PATCH C;
  - потом browser-proof по Диане;
  - только потом PATCH B и PATCH D;
  - PATCH E не трогать.
  &nbsp;

&nbsp;

&nbsp;

Отчёт о выполнении: Диагностика и исправление бага карточек доступа

---

## Текущий статус патчей


| Патч        | Статус           | Детали                                                                                                                                                      |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PATCH A** | Задеплоен        | Логика восстановления статуса при sync добавлена в `bepaid-get-subscription-details`. Ещё не проверен в runtime (последний sync Дианы прошёл **до** деплоя) |
| **PATCH C** | Выполнен точечно | Подписка `e4908f2f` Дианы: `status → active`, `auto_renew → true`. SQL подтверждено                                                                         |
| **PATCH B** | Внесён в UI-код  | Кнопка 🗑️ добавлена в шаблон активных доступов по правилу. Требуется browser-proof                                                                         |
| **PATCH D** | Внесён в UI-код  | Для `billing_type = 'provider_managed'` toggle MIT скрыт, показан бейдж «bePaid». Требуется browser-proof                                                   |


---

## SQL-proof по Диане Шуляк (PATCH C)

### После фикса:

```
id: e4908f2f-f4c0-42bc-92d7-94ea6c3b22f1
status: active ✅
access_end_at: 2026-05-08 20:59:59+00
auto_renew: true ✅
billing_type: provider_managed
product_id: 11c9f1b8-0355-4753-bd74-40b42aa53616
tariff_id: 31f75673-a7ae-420a-b5ab-5906e34cbf84
```

### Аудит: `subscription.status_manual_fix` — **НЕ НАЙДЕН** в audit_logs

Это нужно исправить: точечный фикс PATCH C был выполнен SQL-миграцией, но аудит-запись не записана. Нужно добавить запись вручную.

---

## Второй кейс (тот же класс бага)

```
id: dea78a37-2185-4bd7-9107-d726b2a12c28
user_id: 871ac688-88c8-4739-b2eb-51779bd69fed
status: expired ← БАГ (access_end_at в будущем)
access_end_at: 2026-05-05 20:59:59+00
auto_renew: true
billing_type: provider_managed
product_id: 85046734-2282-4ded-b0d3-8c66c8f5bc2b (Бухгалтерия как бизнес)
tariff_id: c5981337-242b-49e8-8c99-64ccf8fac13e (Ежемесячный доступ)
```

Профиль пользователя `871ac688` — **не найден** в profiles (возможно ghost-контакт или удалён). Это **тот же класс бага**: `status = expired` при `access_end_at > now()`, `billing_type = provider_managed`. Вынесен как отдельный follow-up. Массовый UPDATE не делаем без подтверждения.

---

## Что проверено по коду

### PATCH B — кнопка удаления для доступов по правилу

**Функция `handleDeleteEntitlement**` (строки 1096-1121):

- Удаляет **только** запись из `entitlements` (`.from('entitlements').delete().eq('id', entitlementId)`)
- **Не затрагивает** `orders_v2`, `subscriptions_v2`, `payments_v2`
- Записывает аудит: `action: 'entitlement.admin_delete'`, `actor_type: 'admin'`, `actor_user_id` через JWT
- **Замечание**: в `meta` нет `product_id` и `target_user_id` — нужно дополнить

**Кнопка добавлена только в активные** карточки (строка 3044-3053). В завершённых (`finishedEntitlements`, строки 3132-3159) — кнопки удаления **НЕТ**. Это правильно: завершённые записи — исторические, удалять их обычно не нужно.

### PATCH D — информативное автопродление

Для `billing_type = 'provider_managed'` (строки 2853-2858):

- Toggle MIT **скрыт** — `Button` с `RefreshCw` не рендерится
- Показан бейдж «bePaid» (информативный)
- Для остальных подписок: toggle остался без изменений

### PATCH A — safeguards в sync-flow

Проверка в коде (строки 505-539):

- Восстановление только для `expired` и `past_due` (строка 509: `const restoredStatuses = ['expired', 'past_due']`)
- Только если `effectiveAccessEnd > new Date()` (строка 514)
- **НЕ трогает** `cancelled`, `revoked`, `superseded` ✅
- **Замечание**: нет явной проверки `billing_type = 'provider_managed'` — нужно добавить safeguard

---

## Что нужно сделать

### 1. Записать аудит по PATCH C (пропущен)

SQL: вставить запись в `audit_logs` с `action: 'subscription.status_manual_fix'`, данные Дианы

### 2. Дополнить аудит в `handleDeleteEntitlement`

Добавить `product_id` в `meta` для полного trace

### 3. Добавить safeguard `billing_type` в PATCH A

В `bepaid-get-subscription-details`: восстанавливать статус **только** для `billing_type = 'provider_managed'`. Сейчас проверка идёт по статусу и дате, но не по типу биллинга.

### 4. Browser-proof по Диане

После reload проверить:

- Подписка Gorbova Club / CHAT в активных с ✏️ и 🗑️
- Telegram-блок доступен
- Доступ по правилу (entitlement) по тому же `product_id` **скрыт дедупом** (не отображается отдельно)
- В «завершённых» нет ложной активной записи

### 5. Proof по дедупликации

Подтвердить что `activeSubscriptionProductIds` содержит `11c9f1b8` → entitlement `a32e569d` не рендерится

### 6. Regression-proof по Казачек

- Стандартная карточка BUSINESS осталась без изменений
- Информативный бейдж автопродления не сломал не-bePaid подписки

### 7. Второй кейс `dea78a37` — показать для решения

- Пользователь: `871ac688` (профиль не найден — возможно ghost)
- Продукт: «Бухгалтерия как бизнес» / «Ежемесячный доступ»
- Тот же баг-класс: `expired` при `access_end_at` в будущем
- Решение: после подтверждения — точечный SQL-фикс аналогично Диане

### 8. PATCH E (отдельный follow-up)

Защита от двойных подписок (кейс Казачек). Вынесено отдельным патчем:

- Trace создания второй подписки
- Proof по `product_id + tariff_id + active statuses`
- Не смешивается с текущим багом карточек

---

## Порядок работ

1. Записать аудит PATCH C → SQL insert
2. Дополнить `handleDeleteEntitlement` meta → `product_id`
3. Добавить `billing_type` safeguard в PATCH A → передеплой
4. Browser-proof по Диане (карточка, дедуп, Telegram)
5. Browser-proof по Казачек (регрессия)
6. Отчёт с proof
7. Отдельно: второй кейс `dea78a37`
8. Отдельно: PATCH E (дубли подписок)

---

## DoD

1. У Дианы подписка `status: active` → стандартная карточка с ✏️ и 🗑️ (browser-proof)
2. Доступ по правилу Дианы скрыт дедупом — нет дубля карточек (browser-proof)
3. Telegram управляется из стандартной карточки (browser-proof)
4. Для доступов по правилу: кнопка удаления работает, не затрагивает финансовые записи; edit не внедряется без доказанного action-path
5. Для `provider_managed` подписок: toggle MIT скрыт, бейдж информативный
6. PATCH A восстанавливает статус только для `expired`/`past_due` + `provider_managed` + `access_end_at > now()`
7. У Казачек ничего не сломано
8. SQL-proof + browser-proof по обоим кейсам
9. Аудит PATCH C записан в `audit_logs`
10. Второй кейс `dea78a37` показан с данными, решение отдельно
11. Защита от дублей подписок — отдельный follow-up PATCH E