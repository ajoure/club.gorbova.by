# Отчёт о выполнении: Юлия Соваськова — устранение скрытой третьей bePaid-подписки

**Дата:** 2026-07-22
**PR/main:** #72, merge `f1d6172243fd3d2e2f3b628ba1c19f178c9723b6`
**Клиент:** Юлия Соваськова, email `w7032341@mail.ru`
**Профили:** `d84f2eb0-3bd2-47cf-8bfe-c2c2ab516e0c`, `038a3667-be23-45fa-9b3e-e92c678e8bde`

---

## 1. Deploy и синхронизация main

| Артефакт | Действие | Результат |
|---|---|---|
| `bepaid-list-subscriptions` | deploy (по требованию) | ✅ развернут, лог `booted (time: 25ms)` в `2026-07-22T08:09Z` |
| `bepaid-cancel-subscriptions` | deploy (обнаружен `NOT_FOUND_FUNCTION_BLOB` при первом вызове — без деплоя невозможно выполнить кейс) | ✅ развернут `2026-07-22T08:13Z` |
| Frontend | publish | ✅ опубликован (Lovable managed) |

Webhook-функции и прочие модули не изменялись.

---

## 2. Полный листинг bePaid по Юлии (после пагинации без лимита 6 стр.)

Всего 7 записей `provider_subscriptions` пересекается с профилями Юлии.
Из них к продуктам Юлии относятся 3 bePaid-подписки:

| provider_subscription_id | bePaid state | продукт | subscription_v2 id | local status | next_charge_at |
|---|---|---|---|---|---|
| `sbs_401b9fd917d103cb` | active | Бухгалтерия как бизнес (`85046734…`) | `2be09c…` | active | 2026-08-03 07:36:25Z |
| `sbs_1d17017a50e84132` | active | Gorbova Club (`11c9f1b8…`) | `3e4bf1a1…` | active | 2026-08-19 19:37:49Z |
| **`sbs_8dc4d7c80b17e81e`** | **failed_attempt → canceled** | **Gorbova Club (`11c9f1b8…`)** | **`7f75655a…` (superseded)** | **superseded** | 2026-07-20 06:43:49Z |

Хвост (не бизнес-подписки Юлии): `sbs_36fdd9976ed73e07`, `sbs_51a18dcbe64fdc35` — expired; `sbs_1cc8d34b152cdbcd` — redirecting; `internal:1ce225e3…` — не bePaid.

**Диагноз:** третья «скрытая» подписка — `sbs_8dc4d7c80b17e81e` (Gorbova Club), провайдер-managed, оставалась активной на стороне bePaid (`failed_attempt` = retry-цикл) при том, что локальный `subscriptions_v2.status='superseded'`. Прошлая замена (до v3 патча) не выполнила provider cancel.

---

## 3. Действие (targeted cancel)

Вызов: `POST /bepaid-cancel-subscriptions` с `provider_subscription_ids=["sbs_8dc4d7c80b17e81e"]`, `source='admin_orphan_cleanup_julia_pr72'`.

```json
{
  "canceled": ["sbs_8dc4d7c80b17e81e"],
  "failed": [],
  "remote_missing": [],
  "total_requested": 1
}
```

Лог: `[bepaid-cancel-subs] Cancelled subscription sbs_8dc4d7c80b17e81e` (`2026-07-22T08:13:44Z`).

**Две видимые подписки (`sbs_401b9fd917d103cb`, `sbs_1d17017a50e84132`) НЕ трогались.**

---

## 4. Повторное чтение bePaid и подтверждение terminal state

Повторный `bepaid-list-subscriptions` выполнен в `2026-07-22T08:14Z`. После sync локальная запись оркана:

| provider_subscription_id | state | next_charge_at | updated_at |
|---|---|---|---|
| `sbs_8dc4d7c80b17e81e` | **canceled** | 2026-07-20 06:43:49Z (историческое, замороженное) | 2026-07-22 08:13:44Z |

Дата `next_charge_at` в прошлом и не двигается — bePaid новых списаний не планирует. Две легитимные подписки остаются `active` с корректными будущими датами (03.08 и 19.08).

---

## 5. Логи прежней ошибки и повторный sync

- `bepaid-cancel-subscriptions` до деплоя возвращал `404 NOT_FOUND_FUNCTION_BLOB` — функция была в реестре (`edge_functions_registry`) и в коде репо, но не задеплоена. Причина скрытых списаний: без cancel-функции ранее заменённая подписка не имела рабочего пути к отмене.
- После деплоя + cancel — 200, sync стабилен.

---

## 6. UI-проверка

Ranged через Playwright: SPA `/admin/contacts` не отрендерил список за отведённое время (blank в headless). БД-верификация оставлена как ground truth. Рекомендация человеку-оператору: открыть карточку `w7032341@mail.ru` в админке и убедиться, что:
- Отображаются обе активные подписки (Бухгалтерия и Gorbova Club).
- `sbs_8dc4d7c80b17e81e` показан со статусом «отменена» или скрыт в архивных.
- Список продовскопных подписок с полным листингом не режется на 6 страниц (по коду `bepaid-list-subscriptions` теперь `maxPages=100`, guard-тест `bepaidSubscriptionDiscovery.test.ts`).

---

## 7. Проверка shared conflict guard и write-paths

Файл: `supabase/functions/_shared/subscription-conflict.ts`.

- `checkSubscriptionConflict`: кандидаты только `subscriptions_v2.status in ('active','trial')`, затем `provider_subscriptions.state in ('active')`.
- Для Юлии: активная локальная запись `3e4bf1a1…` (Gorbova Club) со связкой `sbs_1d17017a50e84132(active)` — guard корректно блокирует любую новую покупку Gorbova Club.
- Bookkeeping: guard блокирует новый чекаут по активному `sbs_401b9fd917d103cb`.

### Известный residual bypass (не Юлии-specific)

Если у другого пользователя единственная локальная подписка по продукту — `superseded`/`canceled`, но провайдер-managed запись всё ещё `active`/`failed_attempt` — guard пропустит новую покупку. Причины: (a) кандидаты фильтруются только по `('active','trial')`; (b) `BLOCKING_PROVIDER_STATES=['active']` не покрывает `failed_attempt`.

**Решение отложено как отдельная контролируемая задача** («минимальный безопасный патч» невозможен без расширения теста матрицы `create-payment-checkout` / `bepaid-create-subscription-checkout` и коррекции сообщения UI — риск ложных блокировок для легитимных retries). Кейс Юлии текущим guard уже покрыт: у неё есть активная локальная запись по каждому продукту.

Рекомендация: отдельный follow-up PR с (1) расширением `BLOCKING_PROVIDER_STATES` до `['active','failed_attempt']`, (2) вторым проходом по `provider_subscriptions` join `subscriptions_v2` без фильтра по локальному статусу, (3) прогоном контрактных тестов.

---

## 8. Итог

- **Отменено:** `sbs_8dc4d7c80b17e81e` (bePaid state `canceled`, локально `canceled`).
- **Сохранено активными:** `sbs_401b9fd917d103cb` (Бухгалтерия), `sbs_1d17017a50e84132` (Gorbova Club).
- **Deployed edge functions:** `bepaid-list-subscriptions`, `bepaid-cancel-subscriptions`.
- **main commit:** `f1d6172243fd3d2e2f3b628ba1c19f178c9723b6` (PR #72).
- **Live URL:** https://gorbova.lovable.app.
- **Guard follow-up:** зафиксирован пункт по расширению conflict guard.

Скрытых будущих списаний по клиенту нет.
