# PATCH: Расследование bePaid Subscriptions — Карта источников и архитектурный план (уточнённый финал)

## Обнаруженная критическая проблема (ROOT CAUSE)

**ROOT CAUSE:** Edge Function `bepaid-create-token` создаёт **bePaid subscription** через `POST https://api.bepaid.by/subscriptions` для **любой** рекуррентной логики/первой покупки из Landing/PaymentDialog (включая выбранный пользователем вариант “MIT / Привязать карту”).  
Из-за этого:
1) “Привязать карту (MIT)” фактически **не токенизирует** карту через tokenization checkout  
2) Вместо этого создаётся **реальная provider-managed subscription bePaid** (30-дневный цикл)  
3) Вы получаете “скрытые” автосписания, о которых не было явного UX-согласия

---

## Цель исправления

1) **Жёстко разделить** два сценария оплаты:
   - **MIT/tokenization**: привязали карту → дальше списания у нас (direct charge)  
   - **bePaid subscription**: автосписание делает bePaid (только при явном выборе)
2) **Не ломать** уже работающую токенизацию в `/settings/payment-methods`
3) **Остановить** новые “скрытые” subscriptions, сохранив возможность оплаты для 3DS-карт через bePaid subscription
4) Добавить **guards + диагностику** “unknown_origin” подписок

---

# PATCH-2..PATCH-7 (исполнение)

## PATCH-2 (CRITICAL): `bepaid-create-token` — разделить checkout vs subscription

**Файл:** `supabase/functions/bepaid-create-token/index.ts`  
**Проблема:** сейчас для recurring/первой покупки используется `/subscriptions` API.  
**Исправление:** добавить явный режим работы, чтобы по умолчанию НЕ создавать subscriptions.

### Изменения
1) Добавить параметр запроса:
- `use_provider_subscription?: boolean` (default: `false`)
- `explicit_user_choice?: boolean` (обязателен, если `use_provider_subscription=true`)

2) Логика:

- Если `use_provider_subscription === true`:
  - Разрешать ТОЛЬКО при `explicit_user_choice === true`
  - Использовать текущую логику `POST https://api.bepaid.by/subscriptions`
  - Писать audit_logs: `bepaid.subscription.create_attempt`

- Если `use_provider_subscription !== true` (default):
  - Использовать **checkout payment flow** (НЕ subscriptions API)
  - Цель: создать **обычный checkout платеж** (в т.ч. с 3DS), а сохранение карты для MIT обеспечить **токенизацией** (см. ниже PATCH-2.1)

### Важно (не гадать, сделать по факту)
Сейчас у вас УЖЕ есть рабочий эталон токенизации:
- `payment-methods-tokenize` (использует `transaction_type: 'tokenization'`)

**Требование:** в MIT сценарии первый шаг должен быть:
- либо **tokenization checkout** (получаем токен/сохраняем карту),
- либо payment checkout + подтверждённый способ получить token/profile для дальнейшего MIT (если bePaid так умеет в вашей интеграции).
Если нет 100% доказуемого способа “payment+recurring contract” получить токен — используем tokenization как единственный надёжный вариант.

### PATCH-2.1 (часть PATCH-2): Реиспользовать `payment-methods-tokenize` как общий механизм
Сделать, чтобы Landing/PaymentDialog для “MIT / Привязать карту” вызывал **тот же** механизм, что и `/settings/payment-methods`:
- один и тот же Edge function или общий helper внутри функций
- одинаковый payload tokenization
- одинаковое сохранение результата (card_profile_links / payments_methods / profiles)

DoD:
- При выборе “MIT / Привязать карту” **не создаётся** запись в bePaid subscriptions.
- Карта после прохождения tokenization появляется в PaymentMethods и годится для direct-charge.

---

## PATCH-3 (CRITICAL): PaymentDialog — правильная маршрутизация по flow

**Файл:** `src/components/payment/PaymentDialog.tsx`

### Изменения
1) `paymentFlowType === 'mit'`:
- НЕ вызывать `bepaid-create-subscription-checkout`
- НЕ вызывать `bepaid-create-token` в режиме subscriptions
- Запускать **tokenization flow** (см. PATCH-2.1)
- После успеха: показать “Карта привязана” → дальше либо:
  - (а) сразу списать через direct-charge (если это ваш продуктовый сценарий),
  - (б) либо активировать подписку/доступ по вашим правилам (НО строго после подтверждения оплаты, если есть оплата).

2) `paymentFlowType === 'provider_managed'`:
- вызывать `bepaid-create-subscription-checkout` (как сейчас)
- передавать `explicit_user_choice: true`

DoD:
- Два радиобаттона ведут в два разных backend-flow.
- “MIT” никогда не вызывает subscriptions API.

---

## PATCH-4 (SECURITY): Guard на создание subscriptions (везде)

**Файлы:**
- `supabase/functions/bepaid-create-subscription-checkout/index.ts`
- `supabase/functions/bepaid-create-subscription/index.ts`
- `supabase/functions/bepaid-create-token/index.ts` (если там остаётся режим subscriptions)

### Правило
Любая операция, которая создаёт bePaid subscription через `/subscriptions`, требует:
- `explicit_user_choice === true`
- audit_logs: `bepaid.subscription.create_attempt`
- иначе `403` + audit_logs (без PII)

DoD:
- Невозможно создать subscription “случайно” ни из одного UI/флоу.

---

## PATCH-5 (HIGH): Диагностика “unknown_origin” subscriptions

**Создать:** `/admin/bepaid-subscriptions` (или вкладка в Payments)

### Источник данных
Использовать существующие компоненты/функции (`BepaidSubscriptionsList.tsx`, `bepaid-list-subscriptions`) если они есть.

### Функционал
- Таблица: `bepaid_subscription_id`, status, created_at, next_charge/updated_at, tracking_id, last_transaction.uid
- Колонка `Linked?`:
  - матчинги к `orders_v2 / payments_v2 / provider_subscriptions / subscriptions_v2`
- Фильтры: linked / unlinked / status
- Отдельный блок “unknown_origin” (unlinked)

DoD:
- Я вижу все подписки в bePaid и понимаю, какие из них “наши” и какие нет.

---

## PATCH-6 (MEDIUM): Alerting в существующий Inbox/History (без отдельной вкладки)

События:
- обнаружена новая unlinked subscription
- создана subscription (provider-managed) в результате user choice

Только safe data (id/status/timestamps/tracking_id). RBAC: только admin edit.

---

## PATCH-7 (REGRESSION): Проверки по двум сценариям

### Сценарий A — MIT/tokenization
- после нажатия “Оплатить/Привязать карту (MIT)”:
  - bePaid subscriptions НЕ создаются
  - карта появляется в PaymentMethods
  - direct-charge способен списать (если карта без 3DS)

### Сценарий B — bePaid subscription
- после “Подписка bePaid”:
  - создаётся subscription
  - webhook обрабатывается
  - доступ выдаётся только по факту оплаты/валидного статуса

---

# ВАЖНОЕ уточнение по рискам (обязательный блок)

## Риск 1: уже созданные subscriptions (117 шт.)
Они продолжат списывать, пока не решите, что с ними делать.
**Требование:** только диагностика + список + ручной план действий (без авто-отмен).

## Риск 2: 3DS-карты
MIT/direct-charge по ним может не работать — для них и нужна опция provider-managed subscription.
Поэтому subscription flow должен остаться, но только при явном выборе.

---

# Файлы к изменению (итог)

| Файл | Изменение |
|------|----------|
| `supabase/functions/bepaid-create-token/index.ts` | Разделение flow + default без subscriptions |
| `supabase/functions/payment-methods-tokenize/*` | Реиспользовать как общий механизм (или вынести helper) |
| `src/components/payment/PaymentDialog.tsx` | MIT → tokenization, provider_managed → subscription |
| `supabase/functions/bepaid-create-subscription-checkout/index.ts` | Guard `explicit_user_choice` |
| `supabase/functions/bepaid-create-subscription/index.ts` | Guard `explicit_user_choice` |
| `src/pages/admin/AdminBepaidSubscriptions.tsx` | Диагностика subscriptions |

---

# DoD (Definition of Done)

1) **MIT flow НЕ создаёт subscriptions**:
- в админке bePaid не появляется новая subscription после MIT клика
- в наших логах нет `bepaid.subscription.created` для MIT

2) **Provider-managed flow создаёт subscriptions только при explicit choice**:
- без `explicit_user_choice` → 403 + audit_log

3) **Прозрачность**:
- страница `/admin/bepaid-subscriptions` показывает linked/unlinked
- есть список unknown_origin

4) **UI-пруфы**: скрины из 7500084@gmail.com + логи edge functions + diff-summary