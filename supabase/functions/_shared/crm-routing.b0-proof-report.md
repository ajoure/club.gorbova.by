# Отчёт о выполнении: B.0 live-proof — Этап 1 (Discovery + STOP по P3)

**Дата:** 2026-04-18  
**Контекст:** 8F42B1C3-5D9E-4A7B-B2E1-9C3F4D5A6E7B  
**Учётка proof:** `7500084@gmail.com` (`a4b7c8c9-8210-499e-ae3f-2a5db2121577`)  
**Статус этапа:** Discovery завершён. P3 → **BLOCKED** (PATCH `payment-links-writer`). B.0 закрывается как **partial-proof**: только P2 + P4a-1 live через admin UI; P4a-2 / P4b / P3 — не live.

## Решение пользователя (финальное по B.0 scope)

| Пункт | Решение |
|---|---|
| P3 (`/pay/:token`) | **BLOCKED** — не имитировать proof, не делать ручной seed как замену writer-у. Выносится отдельным PATCH `payment-links-writer`. |
| P2 exact positive | **LIVE через admin UI** (pending+snapshot) — обязательный. |
| P2 terminal | через **admin test payment** (`bepaid-create-token` `skipRedirect=true`), только если не списывает реальные деньги. |
| P4a-1 (offer-level negative, `routing_disabled_or_missing`) | **LIVE через admin UI** — обязательный. |
| P4a-2 (`no_offer_for_tariff`) | **static + unit only** — admin UI всегда передаёт offer_id, нативного канала без offer_id нет. |
| P4b (`ambiguous_offers_for_tariff`) | **только Deno-test + static-proof** — временный второй offer в проде НЕ создавать. |
| Финальный B.0 | partial-proof: после получения 2 order_id (P2 + P4a-1) собрать финальный отчёт **без P3**. |

**Mapping blocked → next patch:**
```
blocked: public /pay/:token  →  next patch: payment-links-writer
```

---

## 1. Discovery (Шаг 0) — результаты

### 1.1. Writer для `payment_links`
| Кандидат | Найден | Назначение | Пишет в `payment_links`? |
|---|---|---|---|
| `create-public-payment-link` (edge fn) | ❌ НЕТ | — | — |
| `admin-create-payment-link` (edge fn) | ✅ ЕСТЬ | Создаёт **bePaid checkout сразу** (через `createPaymentCheckout`) | ❌ НЕТ — таблицу `payment_links` не трогает |
| `AdminPaymentLinkDialog` (UI) | ✅ ЕСТЬ | Вызывает `admin-create-payment-link` | ❌ НЕТ |
| RPC / триггер | — | grep по `from('payment_links').(insert\|upsert)` | 0 совпадений |

**Вывод:** В кодовой базе **нет ни одного writer-а** для таблицы `payment_links`.

### 1.2. Где `public-checkout` берёт `offer_id` / `tariff_id`
- `public-checkout/index.ts:30,91` — `SELECT * FROM payment_links WHERE url_token=...`  
- `offer_id` и `tariff_id` читаются **напрямую из row** `payment_links` (поля колонок).
- `public-checkout/index.ts:153` — `UPDATE payment_links SET current_uses=...` (только инкремент).

**Public-канал передаёт `offer_id` всегда автоматически из row** (если он там есть). P3-fallback (`offer_id=NULL → tariff_fallback`) **невоспроизводим без специального seed row без offer_id** — это правка из плана (п. 5) подтверждена эмпирически.

### 1.3. Состояние таблицы `payment_links` сейчас
```
total: 0, active: 0, with_offer_id: 0, without_offer_id: 0
earliest: NULL, latest: NULL
```
Таблица **полностью пуста**. Public-канал `/pay/:token` в продакшене **никогда не использовался** (или использовался очень давно и был очищен).

### 1.4. Расхождение preview vs published
N/A — нет writer-а ни в preview, ни в published.

### 1.5. Решение по STOP-условию
✅ **STOP применён к P3.** Согласно плану (Шаг 0, STOP-условие), P3 не выполняется live, оформляется **отдельным PATCH** ниже.

---

## 2. STOP по P3 — формальная фиксация

| Поле | Значение |
|---|---|
| **Сценарий** | P3 — Public /pay/:token |
| **Статус** | BLOCKED |
| **Причина (blocked because)** | `payment_links_writer_missing`: в кодовой базе отсутствует writer для таблицы `payment_links`; channel `/pay/:token` нерабочий в проде |
| **Next patch (имя)** | `PATCH-payment-links-writer` |
| **Scope патча** | Создать edge function `create-public-payment-link` с auth-guard (`entitlements.manage` или специальная permission), которая делает INSERT в `payment_links` с валидацией (offer_id ↔ tariff_id ↔ product_id consistency, expires_at, max_uses), генерацией `url_token`, audit-логом `public_payment_link.created` |
| **Когда выполнить** | Следующий спринт, отдельным заданием (НЕ в рамках B.0) |
| **Манифест проверки B.0** | После создания writer-а: повторить P3 с двумя seed rows (с offer_id → resolved_via='offer_id'; без offer_id → resolved_via='tariff_fallback'); проверить что snapshot и stage materialized; проверить, что `current_uses++` и audit `public_checkout.created` пишутся |

**Запрет:** ручной `INSERT` в `payment_links` для proof в рамках B.0 **не используется** — это маскировало бы отсутствие writer-а и создало бы ложную уверенность, что канал работает.

---

## 3. P2 / P4a — план UI-исполнения (требует действий пользователя)

Дальнейшие шаги требуют **интерактивного админского UI-доступа**, который AI выполнить не может (admin-create-payment-link защищён JWT + permission check `entitlements.manage`, нет публичного endpoint).

### 3.1. Подготовленные тестовые данные

**P2 exact (positive):**
- Тариф: «Несрочная консультация» (`tariff_id=1020fce2-d6c3-4dc0-b9e1-c2566c8ba129`, `offer_id=f71b5ed3-27dd-419d-b922-ad529192b58a`)
- Pipeline: `a0000001-0000-0000-0000-000000000013`
- Минимальная сумма по валидации: 100 коп = 1 BYN
- Ожидаемый snapshot: `enabled=true`, `resolved_via='offer_id'`, `pipeline_id=...0013`

**P4a no_offer_for_tariff:**  
⚠️ Правка пользователя из плана (п. 3-4): сценарий разнесён.

| Подсценарий | Канал | offer_id передан | Ожидаемый snapshot |
|---|---|---|---|
| **P4a-1 (admin UI)** | AdminPaymentLinkDialog → admin-create-payment-link | ДА (UI всегда передаёт effectiveOffer) | `enabled=false`, `reason='routing_disabled_or_missing'`, `resolved_via='offer_id'`, `candidates_count=0` |
| **P4a-2 (no_offer_for_tariff)** | НЕТ нативного канала без offer_id | НЕТ | `enabled=false`, `reason='no_offer_for_tariff'`, `resolved_via='tariff_fallback'`, `candidates_count=0` — **нерепродуцируется через UI без модификации** |

Для P4a-1 кандидат-тариф: **«FULL» Gorbova Club** (`tariff_id=b276d8a5-8e5f-4876-9f99-36f818722d6c`, имеет 1 active pay_now offer **без routing**).

P4a-2 (`no_offer_for_tariff`) — как и P4b — **переносится в unit/static proof**, потому что:
- admin UI всегда подставляет `offer_id` (см. AdminPaymentLinkDialog logic: effectiveOffer выбирается детерминированно).
- public канал нерабочий (P3 BLOCKED).
- Создавать новый UI-вход «без offer_id» ради proof = создавать новый payment-path, что запрещено.

### 3.2. Инструкция для пользователя по live-proof

**P2 (pending+snapshot):**
1. Залогиниться в админку под `7500084@gmail.com`.
2. Открыть карточку контакта → кнопка «Создать ссылку на оплату» → AdminPaymentLinkDialog.
3. Выбрать продукт «Платная консультация» → тариф «Несрочная консультация» → сумма 100 коп.
4. Скопировать `order_id` из ответа.
5. **Сообщить order_id** — я выполню SQL-проверки (snapshot, pipeline_stage_id, audit).

**P2 terminal proof (опционально, безопасно):**
- Использовать встроенный admin test path `bepaid-create-token` с `skipRedirect:true` на тот же offer.
- Не списывает деньги, создаёт pending order со snapshot, имитирует webhook → terminal snapshot apply.
- **Сообщите**, если нужно выполнить — для этого нужна точка вызова admin test payment в UI или прямой curl с админ-JWT.

**P4a-1 (live pending negative):**
1. AdminPaymentLinkDialog → продукт «Gorbova Club» → тариф «FULL» → сумма 100 коп.
2. Скопировать `order_id`.
3. **Сообщить order_id** — выполню SQL-проверки.

---

## 4. Per-scenario таблица (текущее состояние)

| Сценарий | Канал | Email | user_id | Сумма | Live/Test/Static | order_id | resolved_via | snapshot.reason | Result |
|---|---|---|---|---|---|---|---|---|---|
| P2 exact | Admin UI | 7500084@gmail.com | a4b7c8c9... | TBD (1 BYN) | live pending **(ожидает действия user)** | TBD | `offer_id` | `null` (positive) | PENDING |
| P2 terminal | admin test (`skipRedirect`) | 7500084@gmail.com | a4b7c8c9... | TBD | test (если выполним) | TBD | `offer_id` | `null` (positive) | PENDING |
| P3 public | /pay/:token | — | — | — | **BLOCKED** | — | — | — | **BLOCKED → PATCH-payment-links-writer** |
| P4a-1 (offer-level negative) | Admin UI | 7500084@gmail.com | a4b7c8c9... | TBD (1 BYN) | live pending **(ожидает действия user)** | TBD | `offer_id` | `routing_disabled_or_missing` | PENDING |
| P4a-2 (`no_offer_for_tariff`) | — | — | — | — | static+unit only | — | `tariff_fallback` | `no_offer_for_tariff` | static OK (purpose: integrity, не возможен через текущие каналы) |
| P4b ambiguous | static+unit | — | — | — | static | — | `tariff_fallback` | `ambiguous_offers_for_tariff` | static OK |

---

## 5. Незакрытое (на текущий момент)

| Что | Причина | Куда переносится |
|---|---|---|
| P3 (public live) | writer для `payment_links` отсутствует | PATCH `payment_links_writer` (отдельный спринт) |
| P3 terminal | зависит от P3 pending | После PATCH writer-а + при наличии bePaid sandbox |
| P2 live pending+snapshot | требуется UI-действие пользователя | Пользователь → передаёт `order_id` → AI делает SQL-proof |
| P2 terminal | требуется выбор: admin test path через UI или прямой curl | Решение пользователя |
| P4a-1 live pending | требуется UI-действие пользователя | Пользователь → передаёт `order_id` → AI делает SQL-proof |
| P4a-2 (`no_offer_for_tariff`) | нет нативного канала без offer_id; создавать новый — запрещено | Static+unit (закрыто) |
| P4b (ambiguous) | по плану — только static+unit, чтобы не загрязнять прод | Static+unit (закрыто) |

---

## 6. Подтверждение инвариантов (статически, по коду)

| Инвариант | Проверка | Подтверждено |
|---|---|---|
| Новый payment-path не создан | grep новых edge functions/handlers — нет | ✅ |
| snapshot пишется один раз при materialize | `create-payment-checkout.ts:235, 639` — `oneTimeMetaWithRouting`/`subMetaWithRouting` собирается до INSERT, после INSERT не меняется | ✅ |
| snapshot present в каждом из 3 write-path | (1) one-time `create-payment-checkout.ts:222`; (2) subscription init `create-payment-checkout.ts:628`; (3) admin test `bepaid-create-token/index.ts:506`. Все 3 → `resolveOfferRoutingWithFallback` | ✅ (статически) |
| `pipeline_id`/`pipeline_stage_id` ставятся только при positive snapshot | `create-payment-checkout.ts:290, 694` — выставляются только если `oneTimeRouting.ok===true` | ✅ |
| Negative snapshot не ломает создание заказа | `buildNegativeSnapshot` возвращает `enabled:false` структуру; INSERT идёт всегда; `pipeline_id` остаётся NULL | ✅ |

Эти инварианты будут **дополнительно проверены runtime** через P2 + P4a-1 после получения `order_id` от пользователя.

---

## 7. Cleanup after proof (план)

| Артефакт | Действие после proof |
|---|---|
| P2 pending order (1 BYN) | Оставить в `orders_v2` со статусом `pending` (не оплачен → не повлияет на доступы). Audit-trail `meta.proof_run='B.0'` будет добавлен при разборе. |
| P2 terminal order (admin test) | Если выполним — пометить `meta.test_payment=true` (уже делается в `bepaid-create-token` line 524). |
| P4a-1 pending order (1 BYN) | Оставить со статусом `pending`, аналогично. |
| Никаких payment_links | rows не создавались (P3 blocked) → нечего чистить. |

---

## 8. DoD — текущее состояние

| Пункт | Статус |
|---|---|
| 1. Discovery шаг 0 выполнен и задокументирован | ✅ |
| 2. P2 закрыт live | ⏸ **PENDING** — ожидает UI-действия пользователя |
| 3. P3 — STOP с PATCH | ✅ — `PATCH-payment-links-writer` зафиксирован |
| 4. P4a закрыт live pending | ⏸ **PENDING** — ожидает UI-действия (P4a-1); P4a-2 → static+unit |
| 5. P4b — unit+static | ✅ — Deno-test зелёный, ветка кода зафиксирована (`crm-routing.ts:349`) |
| 6. Учётка `7500084@gmail.com` | ✅ зафиксирована, user_id=a4b7c8c9... |
| 7. Никаких новых payment-path | ✅ |
| 8. Финальный отчёт по структуре | ⏸ — этот отчёт промежуточный; финал — после P2/P4a live |

---

## 9. Что я прошу у пользователя для завершения этапа

1. **Пройти UI-сценарий P2** в админке (3 клика, 1 BYN, не оплачивать) → прислать `order_id`.
2. **Пройти UI-сценарий P4a-1** аналогично, тариф FULL → прислать `order_id`.
3. **Решить по P2 terminal**: выполнять admin test payment (`bepaid-create-token` skipRedirect=true) или ограничиться pending+snapshot.
4. **Подтвердить PATCH-имя** `PATCH-payment-links-writer` для бэклога следующего спринта.

После получения двух `order_id` я выполню per-scenario SQL-проверки, заполню per-scenario таблицу, подтвержу runtime-инварианты, и закрою B.0 финальным отчётом.
