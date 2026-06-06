да, согласен.

План корректный: это точечный UI-only PATCH без расширения scope.

Особенно важно сохранить:

```text
Изменяется только:
src/components/admin/AdminPaymentLinkDialog.tsx
```

И не трогать:

```text
backend
payment_links
Stripe functions
bePaid
webhook
grant-access-for-order
```

После выполнения нужен только короткий runtime smoke:

```text
Stripe preview EUR = PASS
Stripe preview USD = PASS
Stripe preview PLN = PASS
Stripe preview BYN = PASS
bePaid preview     = PASS
Backend changes    = 0
```

Кнопки/офферы и настройка Stripe Price ID — отдельный будущий спринт, не этот патч.

&nbsp;

План: PATCH 4.1.2 — Currency Preview Fix

## 1. Проблема

В UI диалога создания платёжной ссылки (`AdminPaymentLinkDialog.tsx`) при выборе провайдера Stripe и валют EUR/USD/PLN все текстовые метки и предпросмотр по-прежнему отображают "BYN". Бэкенд при этом создаёт ссылку с правильной валютой — это чисто UI-дефект.

Пример: выбран Stripe + EUR, preview показывает "150 BYN" вместо "150 EUR".

## 2. Диагностика

Текущее состояние: в `AdminPaymentLinkDialog.tsx` валюта захардкожена строкой `BYN` в следующих местах:

- Label поля суммы: `<Label>Сумма (BYN)</Label>`
- Элементы выпадающего списка кнопок: `{Number(o.amount)} BYN`
- Подсказка цены тарифа: `{tariffPrices.price} BYN`
- Блок рассрочки: все суммы с суффиксом `BYN`
- Сводный preview перед отправкой: `{amount} BYN`
- Сводный блок после создания ссылки: `{amount} BYN`

Состояние `stripeCurrency` ("BYN" | "EUR" | "USD" | "PLN") уже существует и корректно передаётся на бэкенд. Не хватает только проброса этого значения в рендеринг меток.

## 3. Предлагаемое решение

Ввести единый derived-валютный токен:

```ts
const previewCurrency = provider === 'stripe' ? stripeCurrency : 'BYN';
```

Заменить все захардкоженные `BYN` в `AdminPaymentLinkDialog.tsx` на `${previewCurrency}` или эквивалентный JSX-вывод.

Если в проекте уже есть вспомогательная функция форматирования валюты — использовать её; иначе использовать inline string interpolation (изменения минимальны).

## 4. Изменяемые компоненты

- `src/components/admin/AdminPaymentLinkDialog.tsx` — замена hardcoded `BYN` на динамический `previewCurrency` во всех UI-метках и preview-блоках.

## 5. Что НЕ будет изменено

- Бэкенд (`admin-create-public-link`, `public-checkout`, `stripe-create-*`, `stripe-webhook`, `grant-access-for-order`)
- Схема `payment_links`
- Логика выбора/фильтрации кнопок и офферов
- bePaid pipeline
- Telegram-логика
- Любые edge functions

## 6. Dry-run

Перед коммитом:

1. Поиск `BYN` внутри `AdminPaymentLinkDialog.tsx` — убедиться, что не осталось ни одного рендер-вхождения, зависящего от провайдера, без условия `provider === 'stripe'`.
2. Локальный просмотр diff: только строковые замены, нет новых импортов, нет изменений типов.

## 7. Execute

- Внести замены `BYN` → `${previewCurrency}` в label, hints, dropdown items, installment block, summary preview, post-creation summary.
- Убедиться, что для bePaid (`provider !== 'stripe'`) поведение остаётся идентичным текущему (всегда 'BYN').

## 8. STOP-guards

- Если при поиске `BYN` обнаружатся вхождения вне UI-меток (state, query params, API calls) — STOP, требуется разбор.
- Если `previewCurrency` может принять значение вне множества `{"BYN","EUR","USD","PLN"}` — STOP.

## 9. DoD

- В предпросмотре «Ссылка на оплату» для Stripe + EUR показывается `X EUR`
- В предпросмотре «Ссылка на оплату» для Stripe + USD показывается `X USD`
- В предпросмотре «Ссылка на оплату» для Stripe + PLN показывается `X PLN`
- В предпросмотре «Ссылка на оплату» для Stripe + BYN показывается `X BYN`
- Для bePaid preview остаётся `X BYN` (регрессии нет)
- Label поля суммы меняется: `Сумма (BYN)` / `Сумма (EUR)` / `Сумма (USD)` / `Сумма (PLN)` по выбору провайдера+валюты
- Runtime smoke на preview: все 5 сценариев PASS в browser preview
- Изменения затронуты только 1 файл: `AdminPaymentLinkDialog.tsx`
- Бэкенд-файлы не изменены

## 10. Риски и зависимости

- Риск: минимальный. Только строковые замены в рендере, нет логических изменений.
- Зависимости: нет. PATCH 4.1.1 уже закрыт и влит.

## 11. Требуется дополнительная информация

Нет. Диагностика по файлу выполнена, scope чётко ограничен UI-only.