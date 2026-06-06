# да, согласен, с учетом правок:

1. **Строго убрать английские термины не только из UI, но и из видимых tooltip/empty/error states**

Проверить новые файлы на видимые строки:

```text
Dunning
Recovery
Final failure
Past due
Smart Retry
Grace
```

Допустимо только в SQL snippets внутри modal, если это технический `meta.stripe.dunning_status`, но рядом должен быть русский комментарий.

2. **Detector-карточку на dashboard не делать, если место не очевидно**

Не тратить время на поиск/перестройку dashboard.

Приоритет:

```text
/admin/payments/payment-issues
```

Detector-карточка — только если существующее место очевидно и без риска.

3. **Action «Открыть подписку» сделать безопасным**

Если универсального detail-view для Stripe нет, не придумывать новый.

Тогда действие:

```text
Открыть клиента
```

или

```text
Открыть карточку клиента
```

Если карточка клиента тоже неочевидна — оставить read-only строку без действия и зафиксировать detail-view в backlog.

4. **Source table**

Использовать:

```text
subscriptions_v2_safe
```

если она уже используется в аналогичных админских хуках.

Если не хватает полей — не переходить сразу на сырую `subscriptions_v2`, а сначала проверить существующий RLS-safe паттерн в админке.

5. **Добавить empty state**

Если проблем с оплатой сейчас нет, вкладка должна показывать понятный текст:

```text
Проблем с оплатой сейчас нет.
Подписки с неуспешной повторной оплатой появятся здесь автоматически.
```

6. **Добавить proof по нулевой когорте**

Если сейчас нет записей с `dunning_status`, это не ошибка.

В proof указать:

```text
Текущая когорта = 0
UI корректно показывает empty state
```

7. **Не закрывать email backlog**

Подтвердить отдельно:

```text
.lovable/backlog/stripe_dunning_email_template.md = остается open
```

После этих правок Phase 3.6-B можно запускать.

&nbsp;

План: Phase 3.6-B — UI Implementation: Проблемы с оплатой

## Контекст

```
Phase 3.5-B Code     = PASS
Phase 3.5-B Runtime  = PENDING-BY-STRIPE-TIME   ← не закрывается этим спринтом
Phase 3.6-A Discovery = APPROVED
```

UI делает существующий маркер `subscriptions_v2.meta.stripe.dunning_status` видимым в админке. Никакой записи в БД, никаких новых backend-процессов.

---

## Объём (UI-only, read-only)

### 1. Новая вкладка «Проблемы с оплатой» в `/admin/payments`

Регистрация в `src/pages/admin/AdminPaymentsHub.tsx` рядом с существующими табами (`Автопродления`, `Подписки BePaid`):

- id: `payment-issues`
- label: **«Проблемы с оплатой»**
- path: `/admin/payments/payment-issues`
- icon: `AlertCircle` (lucide)
- маршрут регистрируется в `src/App.tsx` как `<Route path="/admin/payments/payment-issues" element={<AdminPaymentsHub />} />`

### 2. Индикатор-точка на табе

Аналогично существующему `renewalAlerts?.hasProblems` для `auto-renewals`: красная пульсирующая точка, если есть подписки с `dunning_status` IN (`past_due_grace`, `final_failure`, `canceled_after_dunning`).

### 3. Контент вкладки: `PaymentIssuesTabContent`

Расположение: `src/components/admin/payments/PaymentIssuesTabContent.tsx`.

Структура (сверху вниз):

1. **Стат-карточки** (read-only, аналог `GlassStatCard`):
  - «Ожидает повторной оплаты» — count `past_due_grace`
  - «Оплата не восстановлена» — count `final_failure` + `canceled_after_dunning`
  - «Повторная оплата прошла (за 30 дней)» — count `recovered` за окно
2. **Фильтр-чипы по статусу** (single-select): Все / Ожидает повторной оплаты / Оплата не восстановлена / Повторная оплата прошла.
3. **Таблица подписок** (read-only):
  - Колонки: Клиент (имя + email из `profiles`), Продукт, Тариф, Статус (русский бейдж), «Следующая попытка / Отзыв» (`next_payment_attempt` или `cancel_at`), Причина (читабельный перевод `last_failure_reason`), Сумма + валюта, Действие.
  - Действие: **«Открыть подписку»** → переход в существующий detail (используется тот же путь, что для `BepaidSubscriptionsList`, если применимо для `provider='stripe'`); запрещено любое write-действие.
4. **Секция «Runtime proof 3.5-B»** (внизу, свёрнутая по умолчанию):
  - Текущие счётчики `final_failure` / `canceled_after_dunning` + самая ранняя дата появления.
  - Кнопка **«Проверить proof вручную»** → открывает `PaymentIssuesProofModal` (см. ниже).

### 4. Detector-карточка на дашборде

Расположение: `src/components/admin/dashboard/PaymentIssuesDetectorCard.tsx`.

- Использует тот же hook, что и таб (`usePaymentIssuesCounters`).
- Отображает: «Подписка требует внимания: N» с разбивкой по статусам.
- Клик → `navigate('/admin/payments/payment-issues')`.
- Встраивается в существующий admin-дашборд (точное место — найти при имплементации; если общего «AdminDashboard» нет, временно ограничиться вкладкой и заметкой в proof).

### 5. Modal `PaymentIssuesProofModal`

Расположение: `src/components/admin/payments/PaymentIssuesProofModal.tsx`.

Использует стандартный `<Dialog>` (по правилу UI). Содержит **только текст** — 5 готовых SQL SELECT-снippetов с copy-кнопкой для каждого, без выполнения:

- G44a — состояние `subscriptions_v2` и `audit_logs` для `stripe_dunning_final_failure`.
- G45 — записи `access_grant_ledger` с `meta->>'reconcileBasis'='cancel_at_passed'`.
- Cross-provider safety — поиск активного коммерческого доступа по тому же `user_id` + `product_id` с `provider='bepaid'`.
- G48 — bePaid freeze: count/max(updated_at) `subscriptions_v2` provider=bepaid после триггерного окна.
- Idempotency — поиск дубликатов revoke по `subscription_v2_id`.

Шапка modal: «Эти запросы выполняются вручную в БД-инструменте. UI ничего не пишет и не запускает edge-функции.»

### 6. Hooks (read-only react-query)

Расположение: `src/hooks/admin/`.

- `usePaymentIssuesCounters.ts` — один лёгкий запрос → counts по статусам + earliest_at для `final_failure`. staleTime 60s.
- `usePaymentIssuesSubscriptions.ts` — список подписок с фильтром по статусу. Только `.select(...)`. Лимит 500, deterministic sort по `updated_at desc`.
- Источник: `subscriptions_v2` (или `subscriptions_v2_safe` если RLS-friendly), join по `profiles` и `products_v2` через client-side enrich (как в существующих компонентах).

---

## Словарь UI (обязателен)

Запрещены в коде/UI: `Dunning`, `Recovery`, `Final failure`, `Past due`, `Smart Retry`, `Grace`.


| `meta.stripe.dunning_status` | UI-формулировка          | Цвет бейджа (semantic token) |
| ---------------------------- | ------------------------ | ---------------------------- |
| `past_due_grace`             | Ожидает повторной оплаты | warning / amber              |
| `final_failure`              | Оплата не восстановлена  | destructive                  |
| `canceled_after_dunning`     | Доступ будет отозван     | destructive                  |
| `recovered`                  | Повторная оплата прошла  | success                      |


Доп. подписи:

- «Доступ пока сохранён» (для `past_due_grace`).
- «Доступ будет отозван автоматически» (для `final_failure`/`canceled_after_dunning`).
- «Подписка требует внимания» — заголовок detector-карточки на дашборде.

Все бейджи — через semantic tokens (`bg-warning/15 text-warning`, `bg-destructive/15 text-destructive`, `bg-success/15 text-success`), не hardcoded цвета.

---

## Архитектура

```text
/admin/payments
       │
       └── Tab "Проблемы с оплатой" (новый)
              │
              ├── PaymentIssuesTabContent
              │     ├── usePaymentIssuesCounters  ──SELECT──→ subscriptions_v2
              │     ├── usePaymentIssuesSubscriptions ──SELECT──→ subscriptions_v2 + profiles + products_v2
              │     └── PaymentIssuesProofModal (готовые SQL-снippet'ы, copy only)
              │
              └── Indicator dot (использует usePaymentIssuesCounters)

[Admin Dashboard]
       └── PaymentIssuesDetectorCard ──SELECT──→ usePaymentIssuesCounters
                                                    │
                                                    └── click → navigate('/admin/payments/payment-issues')
```

Никаких новых:

- edge functions,
- миграций,
- RPC,
- cron / GitHub Actions,
- INSERT/UPDATE/DELETE из UI-кода (grep на новых файлах: только `.select(`).

---

## Запреты (жёстко)

- ❌ Любые мутации БД из нового кода.
- ❌ Любые новые edge-функции / cron / workers.
- ❌ Любые изменения в `stripe-webhook`, `subscriptions-reconcile`, `_shared/stripe-subscription-resolver.ts`, `_shared/access-engine/*`.
- ❌ Любые изменения bePaid-кода.
- ❌ Авто-обновление proof-файлов или `system_health_runs`.
- ❌ Использование запрещённого UI-вокабуляра (см. таблицу выше).
- ❌ Закрытие/изменение статуса Runtime 3.5-B этим спринтом.

---

## Список файлов

**Создаются:**

- `src/components/admin/payments/PaymentIssuesTabContent.tsx`
- `src/components/admin/payments/PaymentIssuesProofModal.tsx`
- `src/components/admin/payments/PaymentIssueStatusBadge.tsx` (общий бейдж со словарём)
- `src/components/admin/dashboard/PaymentIssuesDetectorCard.tsx`
- `src/hooks/admin/usePaymentIssuesCounters.ts`
- `src/hooks/admin/usePaymentIssuesSubscriptions.ts`

**Точечно правятся:**

- `src/pages/admin/AdminPaymentsHub.tsx` — добавить таб + рендер контента + индикатор-точку.
- `src/App.tsx` — добавить маршрут `/admin/payments/payment-issues`.
- (опционально, если admin dashboard существует и тривиально находится) — встроить `PaymentIssuesDetectorCard`. Если место не очевидно — оформить как backlog-сноска в proof.

**НЕ трогаются:**

- Любой код в `supabase/functions/**`.
- Любые миграции, типы из `src/integrations/supabase/types.ts`.
- `useAutoRenewalAlerts.ts`, `AutoRenewalsTabContent.tsx`, `BepaidSubscriptionsTabContent.tsx` (только пример для стиля).

---

## Acceptance Criteria (Definition of Done)

- Таб «Проблемы с оплатой» доступен по `/admin/payments/payment-issues` и виден в pills-навигации.
- Стат-карточки и таблица отображают подписки с непустым `meta.stripe.dunning_status`.
- Все статусы и подписи на русском; запрещённые термины отсутствуют (grep по новым файлам).
- Бейджи используют semantic tokens из `index.css`, без hardcoded цветов.
- Modal «Проверить proof вручную» открывается, показывает 5 SQL-снippetов с copy-кнопками; ничего не выполняет.
- Indicator-точка на табе появляется только когда `count(past_due_grace + final_failure + canceled_after_dunning) > 0`.
- Detector-карточка на дашборде (если место встраивания подтверждено) ведёт на новую вкладку.
- grep по новым файлам: `.insert(|.update(|.delete(|.upsert(` = 0 совпадений.
- grep по новым файлам: `supabase.functions.invoke(` = 0 совпадений.
- Нет новых файлов в `supabase/functions/**` и `supabase/migrations/**`.
- `Phase 3.5-B Runtime` остаётся `PENDING-BY-STRIPE-TIME` (явно зафиксировано в proof).
- Proof-документ `.lovable/proofs/payment_issues_admin_ui_v1.md` создан вручную с перечнем добавленных строк/файлов и результатами grep-проверок.

---

## Proof (формат)

После имплементации создаётся `.lovable/proofs/payment_issues_admin_ui_v1.md` со следующими разделами:

1. Список добавленных/изменённых файлов.
2. Результаты grep: запрещённые термины = 0, mutation-методы = 0, `functions.invoke` = 0.
3. Скриншоты вкладки / detector-карточки / modal (опционально, словесное описание допустимо).
4. Текущая фотография когорты: `SELECT count(*) GROUP BY meta->stripe->>'dunning_status'`.
5. Явное подтверждение: «Phase 3.5-B Runtime остаётся PENDING-BY-STRIPE-TIME, UI-спринт его не закрывает».
6. Closes backlog: `.lovable/backlog/stripe_dunning_admin_tab.md` (полностью); `stripe_dunning_email_template.md` — НЕ закрывается (email вне scope).

---

## Открытые вопросы (нужно подтвердить до старта или решить во время имплементации)

1. **Встраивание detector-карточки**: если выделенного «AdminDashboard» в проекте нет — ограничиться вкладкой и зафиксировать как backlog. Подтвердить ОК.
2. **Action «Открыть подписку» для Stripe**: использовать существующий sheet/detail или открыть admin-страницу подписки. Уточнить, если в проекте нет универсального детального view для `provider='stripe'` — тогда action ведёт на отфильтрованный список и проставить «детальный view — backlog».
3. **Source table**: `subscriptions_v2` напрямую или `subscriptions_v2_safe` view (как в `useAutoRenewalAlerts`). По умолчанию — `subscriptions_v2_safe` для единообразия RLS.

Если вопросы блокирующие — отвечаю до старта; иначе фиксирую решения в proof.

---

Ожидаю approve Phase 3.6-B Implementation.