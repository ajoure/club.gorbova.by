да, согласен

Можно выполнять **PAY-I**.

**Контрольный scope**

Только src/components/payment/PaymentDialog.tsx

**Ключевые условия**

1. Карты показываются только disabled.

2. Никаких saved-card оплат из PaymentDialog.

3. Никакого public-charge-saved-card.

4. provider_token не селектить.

5. handlePayment / trial / conflict-flow не трогать.

6. PublicPayPage не трогать.

**Особое замечание**

Сокращение ready-шага делать осторожно:

- не менять условия рендера;

- не менять step-machine;

- не менять обработчики;

- менять только визуальный layout и тексты.

**DoD принимается**

rg "provider_token|public-charge-saved-card|payment_method_verification_jobs|supports_recurring|recurring_verified" src/components/payment/PaymentDialog.tsx

→ 0 совпадений

git diff --name-only

→ только src/components/payment/PaymentDialog.tsx

После выполнения нужен короткий отчёт:

- что изменено;
- grep proof;
- tsc proof;
- подтверждение, что PublicPayPage и edge functions не тронуты.

&nbsp;

План: PAY-I — Compact PaymentDialog ready-step + disabled saved cards

## Диагноз

На скриншотах открыт компонент `src/components/payment/PaymentDialog.tsx` (модалка с тарифного блока на сайтах, кнопка «Выбрать тариф»), а не `PublicPayPage.tsx`. На `/pay/:token` UX корректный (PAY-E-LITE).

Две проблемы в `PaymentDialog`:

1. **Привязанные карты не показываются.** `loadSavedCard` грузит только дефолтную карту через `.eq("is_default", true).maybeSingle()` и пишет в `savedCard` (один объект). В рендере шага `ready` UI отображения `savedCard` отсутствует. Карты невидимы и для подписки, и для one_time.
2. **Шаг `ready` перегружен.** Блок профиля → ShieldCheck-плашка → длинный subscription-info (5 абзацев) → отдельный длинный блок «При оформлении подписки bePaid…» → кнопки → admin-test. Кнопки уезжают за второй экран.

## Scope

Только `src/components/payment/PaymentDialog.tsx`.

## Что сделать

### 1. Загрузка карт — список вместо одной

Заменить `loadSavedCard` на `loadSavedCards`:

```
.from("payment_methods")
.select("id, brand, last4, exp_month, exp_year, is_default")
.eq("user_id", user.id)
.eq("status", "active")
.eq("provider", "bepaid")
.order("is_default", { ascending: false })
.order("created_at", { ascending: false })
```

Состояние: `savedCards: Array<{...}>` вместо одиночного `savedCard`.

**НЕ селектить**: `provider_token`, `verification_status`, `supports_recurring`, `recurring_verified`, и не трогать `payment_method_verification_jobs`.

### 2. UI карт в шаге `ready` — всегда disabled

Если `savedCards.length > 0`, показать компактный блок «Сохранённые карты» в виде:

```
[CARD] VISA ••••1234   [по умолчанию]
```

с `opacity-60 pointer-events-none select-none aria-disabled="true"`.

Подпись под списком:

- **subscription**: «Сохранённые карты нельзя выбрать для оформления подписки. Вас перенаправит на защищённую страницу bePaid, где нужно будет выбрать или ввести карту для подписки.»
- **one_time**: «Оплата сохранённой картой в этом окне пока недоступна. Используйте стандартную оплату bePaid.»

Если `savedCards.length === 0` — блок не рендерим.

### 3. Сокращение шага `ready`

- **Профиль** (Email/Имя/Телефон) → одна компактная строка вида `{email} · {имя} · {телефон}` в одной плашке.
- **ShieldCheck-блок** «После нажатия кнопки вы будете перенаправлены…» → удалить как отдельную плашку, оставить короткой строкой мелким шрифтом под кнопками.
- **subscription-info** — две короткие строки:
  - «Сегодня: доступ к Клубу — {price}.» (и аналогичные краткие варианты для курсов / обычных подписок)
  - «Далее автосписание раз в месяц. Управление в личном кабинете.»
- **PAY-G длинный блок** «При оформлении подписки bePaid…» — удалить как отдельную карточку, оставить **внутри** subscription-info короткой строкой:
«bePaid может показать экран «привязка карты для автоплатежей» — это штатный экран оформления подписки.»

### 4. CTA

Оставить текущие кнопки и обработчики:

- Главная: `Оплатить {price}` → `handlePayment` (логика не меняется).
- Вторичная: `Отмена`.

`handlePayment`, `handleReplaceSubscription`, `handleTestPayment`, conflict-flow, trial-flow — не трогать.

## STOP-guards

- STOP, если карты становятся кликабельными.
- STOP, если PaymentDialog вызывает `public-charge-saved-card`.
- STOP, если меняется `handlePayment`, `handleReplaceSubscription`, `handleTestPayment`.
- STOP, если меняется bePaid payload.
- STOP, если `provider_token` появляется во frontend.
- STOP, если меняется `PublicPayPage.tsx`.
- STOP, если добавляется MIT/saved-card payment-flow в PaymentDialog.
- STOP, если меняются edge functions.
- STOP, если меняется `LandingPricing` / `UniversalPricingSection` / тарифные блоки.

## DoD

1. На viewport **518×788** CTA-кнопки «Отмена» и «Оплатить {price}» видны без прокрутки в типовом сценарии: subscription + авторизованный пользователь + 1–2 сохранённые карты. При 5+ картах или длинных данных профиля небольшой скролл допустим.
2. Если у пользователя есть сохранённые карты — они отображаются **disabled** с соответствующим текстом для subscription / one_time.
3. Если карт нет — блок карт отсутствует, ничего не ломается.
4. one_time PaymentDialog не показывает кликабельные карты (политика `mem://ui/payments/saved-card-client-policy` сохраняется).
5. `PublicPayPage.tsx` не изменён.
6. `tsc --noEmit` чистый.
7. `rg "provider_token|public-charge-saved-card|payment_method_verification_jobs|supports_recurring|recurring_verified" src/components/payment/PaymentDialog.tsx` → **0 совпадений**.
8. `git diff --name-only` → только `src/components/payment/PaymentDialog.tsx`.

## Затронутые файлы

- `src/components/payment/PaymentDialog.tsx` — единственный файл изменений.