# PATCH P0 / F2 / P2 — Оплата консультации + inline auth + ошибки

## Статус PATCHей

| PATCH | Статус |
|-------|--------|
| A — suffix/config-driven | CLOSED |
| B — equal-height layout | PARTIALLY VERIFIED |
| C — carousel UX | OPEN |
| D — product↔page binding + anchors | CLOSED |
| E — pricing block detection + diagnostics | CLOSED |
| F1 — убрать redirect на /auth | CLOSED |
| F2 — resume payment after inline auth | PARTIAL — authInProgressRef добавлен, нужен browser-proof |
| **P0 — hotfix оплаты консультации** | **FIXED** |
| **P0.1 — saved card UI guard + fallback** | **FIXED** |
| **P2 — клиентские ошибки оплаты** | **FIXED** |

## P0 — Root Cause и Fix

### Root Cause (подтверждено)

`PaymentDialog.handlePayment()` вызывал `bepaid-create-token` **без `isOneTime: true`** для non-subscription продуктов (консультации). Консультации имеют `requires_card_tokenization: false`, поэтому `isSubscription=false`, но `isOneTime` нигде не передавался.

В `bepaid-create-token/index.ts`:
- Line 648: `if (isOneTime)` → checkout API (one-time) ← **не попадал**
- Line 738: `if (useMitTokenization)` → MIT flow ← **не попадал**  
- Line 861: HARD GUARD → 403 `SUBSCRIPTION_PATH_BLOCKED` ← **сюда попадал**

Edge log: `[bepaid-create-token] BLOCKED: legacy subscription path attempted without explicit choice`

### Fix (PaymentDialog.tsx)

```typescript
// Line 512: добавлено
const isOneTimePayment = !isSubscription && !isTrial;

// В payload bepaid-create-token:
isOneTime: isOneTimePayment,
```

### Decision Gate: Saved Card UI

Saved card UI для one-time продуктов — **cosmetic only**. Реальная оплата всегда идёт через bePaid checkout redirect (новая карта или saved card обрабатывается bePaid). UI показывает сохранённую карту как информацию, но actual charge path одинаков. Это корректное поведение — не требует скрытия.

### DB Proof: Consultation Offers

| Tariff | offer_type | amount | requires_card_tokenization |
|--------|-----------|--------|---------------------------|
| CONSULTATION_STANDARD | pay_now | 500 | false |
| CONSULTATION_URGENT | pay_now | 800 | false |
| help | pay_now | 1500 | false |
| strategy | pay_now | 4500 | false |

Все офферы — one-time, не subscription. `isOneTime: true` теперь корректно передаётся.

## P0.1 — Saved Card UI Guard + Fallback

### Что сделано

1. **Saved card UI скрыт для one-time продуктов**: guard `savedCard && (isSubscription || isTrial)` — для консультаций показывается стандартный текст "перенаправлены на защищённую страницу оплаты bePaid".
2. **Контекстные сообщения об ошибках**:
   - One-time: «Не удалось открыть страницу оплаты. Попробуйте ещё раз.»
   - Subscription с saved card: «Не удалось продолжить оплату. Попробуйте ещё раз или оплатите другой картой.»
   - Прочее: `normalizeEdgeFunctionError(error)`
3. **Модалка не закрывается при ошибке**: убран `setStep("ready")` из catch — пользователь остаётся на текущем шаге.
4. **Кнопка**: всегда "Оплатить {price}" для one-time, без зависимости от savedCard.

## P2 — Нормализация ошибок

### Fix

Заменён `toast.error(error.message)` на контекстные сообщения + `normalizeEdgeFunctionError` как fallback. Raw backend ошибки пользователю больше не показываются.

## F2 — Статус

`authInProgressRef` добавлен и работает в коде. Требуется browser-proof:
- логин внутри окна → окно не закрывается
- выбранный тариф не теряется
- сразу переход к step="ready"

## Файлы

| Файл | Изменение |
|------|-----------|
| `src/components/payment/PaymentDialog.tsx` | isOneTime в payload, saved card UI guard, контекстные ошибки, кнопка, authInProgressRef (ранее) |

## FROZEN

Auth.tsx, edge functions, таблицы — не изменены.
