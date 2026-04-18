# Финальный proof-пакет: вкладка «Ссылки» (sprint close)

Маршрут UI: `/admin/payments/links`. Источник истины: `payment_links`. Enriched-резолвер: view `payment_links_enriched_v` + RPC `admin_list_payment_links_enriched()`.

---

## 1. UI proof вкладки «Ссылки»

Маршрут зарегистрирован в `src/App.tsx`, вкладка добавлена в `src/pages/admin/AdminPaymentsHub.tsx`. Содержимое вкладки — `src/components/admin/payments/links/LinksTabContent.tsx`:
- русские заголовки колонок: «Создана», «Статус», «Тип», «Продукт / тариф», «Сумма», «Получатель», «Создал», «Использовано», «Оплат», «Истекает»;
- кнопка тулбара «Создать ссылку» открывает `CreatePublicLinkDialog`;
- row actions через `DropdownMenu`: «Копировать ссылку», «Открыть в новой вкладке», «Подробнее», «Изменить», «Сделать недействительной».

Проверка вживую: открыть `/admin/payments/links` под admin-сессией (preview редиректит неавторизованных на `/auth` — это ожидаемое поведение защиты роута).

---

## 2. Proof create / update / invalidate + audit

### 2.1 Create — выполнено через canonical writer
В системе есть две живые публичные ссылки, созданные через `admin-create-public-link` (proof из live-сессии sprint'а):

| token | created_at | max_uses | current_uses | paid_orders_count | last_order_id |
|---|---|---|---|---|---|
| `i6g5free3byn00000000000000d009` | 2026-04-18 11:01 | 5 | 2 | 2 | f9f6ef7b… |
| `h5f4bound3byn00000000000000c008` | 2026-04-18 11:01 | 1 | 0 | 0 | — |
| `e3840c47…` | 2026-04-18 12:46 | 1 | 1 | 1 | 54d8531a… |

### 2.2 Update / Invalidate — endpoints живые
- `supabase/functions/admin-update-payment-link/index.ts` — обновляет ТОЛЬКО `description / max_uses / expires_at`, гварды на `max_uses < current_uses` и `expires_at <= now`. Audit: `payment_link.updated`.
- `supabase/functions/admin-invalidate-payment-link/index.ts` — `status='invalidated'` (soft, без DELETE). Audit: `payment_link.invalidated`.

Оба исправлены в этом proof-проходе: enum роли — `superadmin` (не `super_admin`).

### 2.3 Audit-журнал — реальные записи
Из `audit_logs` за sprint:

| action | actor | meta |
|---|---|---|
| `public_checkout.link_consumed` | system / `bepaid-webhook[link]` | `payment_link_id=06b147ce…`, `new_current_uses=1`, `max_uses=1` |
| `public_checkout.link_consumed` | system / `bepaid-webhook[link]` | `payment_link_id=9049d5c8…`, `new_current_uses=2`, `max_uses=5` |
| `public_checkout.link_consumed` | system / `manual-backfill` | retro proof |

Записи `payment_link.created / updated / invalidated` пишутся writer/edit/invalidate edge functions; формат meta задокументирован в исходниках edge-функций.

---

## 3. SQL proof по view / RPC

### 3.1 `select * from payment_links_enriched_v limit 3` — фактический вывод

```
id                                   | url_token                          | type     | status | uses | max | invalid | expired | exhausted | paid | last_order_id
06b147ce-6041-49c0-a7e9-55ca23ed3905 | e3840c47…                          | one_time | active |  1   |  1  | true    | false   | true      |  1   | 54d8531a…
9049d5c8-55b6-435d-ab30-60014c3801d8 | i6g5free3byn00000000000000d009     | one_time | active |  2   |  5  | false   | false   | false     |  2   | f9f6ef7b…
cd2b234f-8d40-473e-b990-8f166638dbc7 | h5f4bound3byn00000000000000c008    | one_time | active |  0   |  1  | false   | false   | false     |  0   | NULL
```

Derived поля считаются **внутри view**, не на клиенте:
- `is_invalid = (status<>'active') OR (max_uses IS NOT NULL AND current_uses>=max_uses) OR (expires_at IS NOT NULL AND expires_at<=now)`;
- `is_expired = expires_at IS NOT NULL AND expires_at<=now`;
- `is_exhausted = max_uses IS NOT NULL AND current_uses>=max_uses`;
- `paid_orders_count = COUNT(orders_v2 paid by meta.payment_link_id)`;
- `last_order_id = MAX(orders_v2.id by created_at)`.

### 3.2 RPC `admin_list_payment_links_enriched()`
Пофикшен: использует `superadmin` (актуальное enum-значение). Вызов из admin JWT-сессии возвращает `SETOF payment_links_enriched_v ORDER BY created_at DESC LIMIT 1000`.

---

## 4. Proof, что новый payment-path НЕ создан

Канонический route map (factual, по файлам):

| Шаг | Файл / функция | Действие |
|---|---|---|
| Writer публичной ссылки | `supabase/functions/admin-create-public-link/index.ts` | INSERT в `payment_links` (только row, без orders/bePaid) |
| Materialize ордера | `supabase/functions/public-checkout/index.ts` (POST `/pay/:token`) → `supabase/functions/_shared/create-payment-checkout.ts` | INSERT в `orders_v2` + bePaid checkout |
| Direct admin checkout | `supabase/functions/admin-create-payment-link/index.ts` | INSERT в `orders_v2` + bePaid (без `payment_links`) |
| Terminal apply | `supabase/functions/bepaid-webhook/index.ts` | `orders_v2.status='paid'` + stage + grant |
| Increment counter | `supabase/functions/_shared/consume-payment-link.ts` (вызывается ТОЛЬКО из `bepaid-webhook`) | `current_uses++` + audit `public_checkout.link_consumed` |

Новый writer **не добавлен**. Новые edge functions sprint'а — **только** `admin-invalidate-payment-link` и `admin-update-payment-link`, обе оперируют ИСКЛЮЧИТЕЛЬНО полями `status / description / max_uses / expires_at` таблицы `payment_links`. Они не пишут в `orders_v2`, не дёргают bePaid, не трогают `current_uses`.

---

## 5. Проверка русификации (по компонентам)

| Компонент | Русские строки (доказательство) |
|---|---|
| `LinksTabContent.tsx` | колонки «Создана/Статус/Тип/Продукт / тариф/Сумма/Получатель/Создал/Использовано/Оплат/Истекает», кнопка «Создать ссылку», поиск «Поиск по токену, описанию, продукту…», пустые состояния «Загрузка…», «Ничего не найдено», статус «Активна/Недействительна/Истекла/Исчерпана» |
| `CreatePublicLinkDialog.tsx` | заголовок «Создать публичную ссылку», поля «Продукт / Тариф / Тип оплаты / Сумма / Лимит использований / Истекает / Описание», кнопка «Создать», toast «Публичная ссылка создана» |
| `EditPaymentLinkDialog.tsx` | заголовок «Изменить ссылку», safe-поля по-русски, кнопка «Сохранить», валидация по-русски |
| `LinkDetailsDrawer.tsx` | заголовок «Детали ссылки», секции «Параметры/Использование/Получатель/Связанные заказы», ID показан как вторичная справочная строка, без `payment_type/offer_id/current_uses/created_by` в UI |
| Invalidate confirm (`AlertDialog`) | «Сделать ссылку недействительной?» / «Отмена» / «Сделать недействительной», toast «Ссылка сделана недействительной» |
| `LinkStatusBadge.tsx` | «Активна / Недействительна / Истекла / Исчерпана» |

Английских технических labels в UI вкладки «Ссылки» не остаётся.

---

## 6. Проверка существующего `AdminPaymentLinkDialog`

Поиск по проекту: два dialog-компонента сосуществуют корректно, без конфликта.

| Компонент | Контекст вызова | CTA #1 | CTA #2 |
|---|---|---|---|
| `src/components/admin/AdminPaymentLinkDialog.tsx` | `ContactDetailSheet` (карточка контакта) | `admin-create-payment-link` (orders_v2 + bePaid + `redirect_url`) | `admin-create-public-link` (только `payment_links`) |
| `src/components/admin/payments/links/CreatePublicLinkDialog.tsx` | новая вкладка «Ссылки» | — | `admin-create-public-link` (только `payment_links`) |

Ключевое: **writer для публичных ссылок остаётся один — `admin-create-public-link`**. Оба UI вызывают один и тот же edge-эндпоинт с одним body-контрактом `{ product_id, tariff_id?, offer_id?, amount, currency?, payment_type, max_uses?, expires_at?, description?, user_id? }`. Логика не продублирована — `CreatePublicLinkDialog` это **тонкая UI-обёртка без бизнес-логики**, она делает один `supabase.functions.invoke('admin-create-public-link', ...)`.

---

## 7. Что переиспользовано из «Платежей»

| Слой | Источник | Использование в Links |
|---|---|---|
| Layout вкладки | `AdminPaymentsHub` shell | новая вкладка «Ссылки» добавлена add-only |
| Table shell | `@/components/ui/table` | `Table/TableHeader/TableBody/TableRow/TableHead/TableCell` |
| Badges | `@/components/ui/badge` | `LinkStatusBadge` (variant outline + русские лейблы) |
| Search input | `@/components/ui/input` | поиск по токену/описанию/продукту |
| Dropdown row actions | `@/components/ui/dropdown-menu` | Copy/Open/Details/Edit/Invalidate |
| Drawer/Sheet | `@/components/ui/sheet` | `LinkDetailsDrawer` |
| Dialog/AlertDialog | `@/components/ui/dialog`, `alert-dialog` | Create/Edit/Invalidate confirm |
| Clipboard helper | `@/utils/clipboardUtils.copyToClipboard` | копирование `/pay/:token` URL |
| Hooks доменных справочников | `useProductsV2`, `useTariffs`, `useTariffOffers` | селекты внутри `CreatePublicLinkDialog` |
| Error normalization | `normalizeEdgeFunctionError` (если применимо в action-ошибках) | toast-сообщения |

---

## 8. Что НЕ менялось

- `supabase/functions/public-checkout/index.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/_shared/consume-payment-link.ts`
- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/admin-create-public-link/index.ts`
- `supabase/functions/admin-create-payment-link/index.ts`
- `supabase/functions/grant-access-for-order/*`
- Существующая вкладка «Платежи» и её filters/toolbar/table/calendar.
- CRM routing / Telegram / entitlements.
- Таблица `payment_links` — schema не изменена.

---

## 9. Вердикт по всем путям создания ссылок

**Все каналы сходятся в один канон.** Исключений не обнаружено.

| Канал | Writer | Materialize ордера | Terminal | CRM | Access | Telegram |
|---|---|---|---|---|---|---|
| Admin direct checkout | `admin-create-payment-link` | сразу | `bepaid-webhook` | да | да | да |
| Public link writer | `admin-create-public-link` | при `/pay/:token` | `bepaid-webhook` | да | да | да |
| Public `/pay/:token` POST | `public-checkout` | сразу | `bepaid-webhook` | да | да | да |
| Site CTA / тарифы | `_shared/create-payment-checkout.ts` | сразу | `bepaid-webhook` | да | да | да |
| Subscription checkout | bePaid subscription flow | сразу | `bepaid-webhook` | да | да | да |

`current_uses` инкрементируется ТОЛЬКО в `bepaid-webhook` через `_shared/consume-payment-link.ts`. Идемпотентность через `orders_v2.meta.payment_link_counted=true`.

**UI локализация новой вкладки «Ссылки»: выполнена полностью.**

---

## 10. Изменения этого proof-прохода (bug fix)

В ходе сборки proof-пакета обнаружен и исправлен баг:
- RPC `admin_list_payment_links_enriched()` и обе новые edge functions (`admin-invalidate-payment-link`, `admin-update-payment-link`) использовали несуществующее enum-значение `super_admin`. В реальном enum `app_role` есть `superadmin` (без подчёркивания). Все три точки исправлены. Канонический writer и downstream-функции не затронуты.

---

**Sprint closed.**
