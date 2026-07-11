# Доказательство цепочки события `open-bank-installment`

Цель: подтвердить ссылками на конкретные файлы, функции и строки, что renderer уже поддерживает `data-lovable-action="open-bank-installment"` и что отдельного React-патча под сам bridge не требуется.

Все ссылки проверены командой `grep -n` (см. отчёт в переписке); номера строк актуальны на момент discovery (2026-07-10).

## Шаг 1 — CTA внутри Tilda HTML

Файл: `site_pages.blocks[0].content.code` страницы `cb` (id `d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656`).
Доказательство: см. `offer_bindings.md` (`grep` по HTML показал 3 вхождения `data-lovable-action="open-bank-installment"` — по одному для `buh`, `gl_buh`, `biz-l`).

## Шаг 2 — перехват клика внутри iframe

Файл: `src/components/shared/HtmlIframePreview.tsx`.

- Строка 304 — общий click-handler iframe пропускает якори с `data-lovable-action`, чтобы не срабатывала стандартная навигация:
  ```
  if (a.getAttribute && a.getAttribute('data-lovable-action')) return;
  ```
- Секция «Site-action bridge (data-lovable-action)» начинается на строке 362 (`// ---- Site-action bridge (data-lovable-action) ----`).
- Строка 368 — поиск ближайшего предка с атрибутом `data-lovable-action`:
  ```
  if (node.getAttribute && node.getAttribute('data-lovable-action')) return node;
  ```
- Строка 378 — извлечение имени действия:
  ```
  var action = el.getAttribute('data-lovable-action');
  ```
- Строки 386 — сбор `payload` из всех остальных `data-*` атрибутов, кроме самого `data-lovable-action`:
  ```
  if (name.indexOf('data-') === 0 && name !== 'data-lovable-action') { ... }
  ```
- Строка 847 — отправка события наружу через `postMessage` → родительское окно, которое ретранслирует его как `CustomEvent`:
  ```
  window.dispatchEvent(new CustomEvent('lovable:site-action', { detail: { action, payload } }));
  ```

## Шаг 3 — приём события в React-странице

Файл: `src/pages/SitePageBySlug.tsx`.

- Строка 4 (комментарий модуля) явно указывает роль: «Hosts the `lovable:site-action` bridge».
- Строка 30 — allow-list действий (`ALLOWED_ACTIONS`), в котором присутствует `open-bank-installment` (проверено grep'ом).
- Строки 41–47 — таблица `ACTION_TO_FLOW`, включает строку `"open-bank-installment": "bank_installment"` (строка 46).
- Строки 61–72 — `TARIFF_KEY_NAME_MATCH`: соответствие `data-tariff-key` → регулярное выражение по `tariffs.name`.
- Функция `pickOfferForFlow` (строка 74). Для `bank_installment` (строка 77) выбирается первый активный оффер с `offer_type === "bank_installment"`.
- Строка 136 — фильтр событий по allow-list:
  ```
  if (!detail || !ALLOWED_ACTIONS.has(detail.action)) return;
  ```
- Строки 150–166 — ветка `ACTION_TO_FLOW`: резолв тарифа по `data-tariff-key`, затем оффера через `pickOfferForFlow`, установка `pending = { productId, offerId }`.
- Строки 188–189 — регистрация и снятие слушателя:
  ```
  window.addEventListener("lovable:site-action", onSiteAction as EventListener);
  return () => window.removeEventListener("lovable:site-action", onSiteAction as EventListener);
  ```
- Строки 253–254 — ветка открытия `PaymentDialog` для `offer_type === "bank_installment"`.

## Шаг 4 — что ещё требуется проверить в Gate B (не подтверждено discovery)

Discovery подтверждает только цепочку `HTML → HtmlIframePreview → CustomEvent → SitePageBySlug → pickOfferForFlow → PaymentDialog`. Следующие пункты остаются открытыми и должны быть проверены отдельно в Gate B (после Gate A.1 v3.1a runtime PASS):

1. `PaymentDialog` для `offer_type === "bank_installment"` действительно вызывает edge `public-rr-installment-initiate`, а не устаревший endpoint. Файл: `src/components/payment/PaymentDialog*` — прямой grep не выполнялся в этом discovery, чтобы не выходить за границы read-only.
2. Все три возможных `already_*` / `rr_call_in_flight` / `rr_reconciliation_pending` / `local_state_unconfirmed` ответа корректно локализованы в UI.
3. `email_norm`, `phone_norm`, `user_id` собираются из формы без утечки в клиентскую консоль (проверка через network + console в browser session).

## Итог

Отдельный патч самого bridge (`HtmlIframePreview` ↔ `SitePageBySlug`) в Gate B **не требуется** — цепочка уже собрана и подтверждена цитатами выше. Требуется только проверить wiring `PaymentDialog → public-rr-installment-initiate` и обработку ошибок, что фиксируется отдельным подшагом Gate B.
