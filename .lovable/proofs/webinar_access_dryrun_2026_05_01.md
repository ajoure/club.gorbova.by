# Webinar Access — Consolidated Dry-run (read-only)
Дата: 2026-05-01
Статус: **БЕЗ EXECUTE**. Никаких записей в БД, миграций, trigger install, cleanup rules.

---

## Блок 1. `meta.deal_month` backfill

**Цель**: убедиться, что у каждого `paid` заказа есть `meta.deal_month` (YYYY-MM, Europe/Minsk).

### Rowcount
| метрика | значение |
|---|---|
| `orders_v2 status='paid'` (всего) | **2270** |
| с `meta.deal_month` | **2270** |
| без `meta.deal_month` | **0** |
| без `meta.deal_month` И `deal_date IS NULL` | **0** |

### Список заказов на backfill
**Пусто.** Все исторические `paid`-заказы уже имеют `meta.deal_month`. Backfill-запись не требуется.

### Ambiguous / manual review
- **Кейс «Ирина Тройнич, БкБ как business»**: проверен прямой выгрузкой её 8 BUSINESS-заказов Gorbova Club — у всех `meta.deal_month` корректно проставлен (`2025-10` … `2026-04`). Заказ от 21.04.2026 → `deal_month=2026-04`. **Жалоба «месяц не проставился» в текущем состоянии БД не воспроизводится** — либо уже исправлено бэкфиллом, либо проблема была не в этом поле.

### Предложение
Сейчас руками чинить нечего. Триггер-автозаполнение `orders_v2_autofill_deal_month_trg` остаётся **полезным как guard на будущее** (любой новый `paid` без `deal_month` → авто), но это install-only, **execute требует отдельного approval**.

---

## Блок 2. Webinar access cleanup — leaking rules

Webinar root: `8c7fd507-bb76-4308-9ac2-1e4ffea62d61` («Вебинары»), parent = `8b1fb03e-…` («База знаний»).
Все правила с `grant_target_type='training_content'` вешаются на root **«База знаний»**, поэтому именно они формируют доступ к вебинарам.

### Все 5 активных rule на «База знаний» — текущий эффект

| rule_id | продукт | tariff | mode | month_gate | webinar-модулей в allowed | теоретически открывает webinar subtree без BUSINESS+month-gate? |
|---|---|---|---|---|---|---|
| `70510431-…` | Gorbova Club (`11c9f1b8`) | **BUSINESS** | partial | **true** | 12 (все) | ✅ корректно (это и есть нужное правило) |
| `19b66114-…` | Gorbova Club (`11c9f1b8`) | FULL | partial | false | 0 (только 2 не-вебинарных модуля) | ✅ нет утечки |
| `417e5071-…` | `f9e53860-…` (ghost-продукт «Налоговый кодекс-2026») | — | **full** | — | 1 в `allowed_module_ids`, но `mode=full` → resolver игнорирует список → **открывает ВСЁ под «База знаний», включая 12 вебинаров, без month-gate** | ⚠️ **ДЫРА** |
| `a377fb0b-…` | `b868013a-…` (ghost «БЕЗОПАСНОСТЬ ПД 2025») | — | partial | false | 1 (`4eb44790` = вебинар 2025-01) | ⚠️ открывает 1 вебинар без month-gate |
| `ecf3e655-…` | `84055f12-…` (ghost «Как не платить штрафы») | — | partial | false | 1 (`24b5980d` = вебинар 2025-09) | ⚠️ открывает 1 вебинар без month-gate |

### Затронутые пользователи
| продукт-источник | active entitlements | paid orders |
|---|---|---|
| `f9e53860-…` (Налоговый кодекс-2026) | **0** | **0** |
| `b868013a-…` (БЕЗОПАСНОСТЬ ПД) | **0** | **0** |
| `84055f12-…` (Как не платить штрафы) | **0** | **0** |

**Реальная утечка прямо сейчас = 0 пользователей.** Правила «спящие» (продуктов нет в `products`, никто не владеет). Но они опасны на будущее: если кто-то получит entitlement на эти ghost-продукты (через legacy импорт/manual insert) — мгновенно получит доступ ко всем вебинарам.

### Предлагаемый cleanup (НЕ выполнять без approval)
1. **`417e5071`** (full→дыра): варианты:
   - (A) деактивировать (`is_active=false`) — самое безопасное, продукт мёртв.
   - (B) перевести `access_mode` → `partial` и оставить `allowed_module_ids=[a0291939]` — тогда только 1 вебинар, но **без month-gate** → всё равно нарушает SOT.
   - **Рекомендация: A (deactivate)**. Если бизнес хочет сохранить standalone-бонус «Налоговый кодекс-2026» — пересоздать как `tariff_id=BUSINESS subset`.
2. **`a377fb0b`, `ecf3e655`** (по 1 вебинар без month-gate): аналогично — **deactivate** (продуктов нет). Если бизнес хочет именно standalone-бонус без month-gate — оставить как есть; формально это допустимо, т.к. покупка продукта = право на конкретный вебинар. **Решение бизнеса.**

### Read-path guard (опциональное hardening)
Добавить в `useTrainingContentRules.ts` / `access-resolver.ts` явный invariant:
> Если `target_ref` рекурсивно содержит модуль с `parent_module_id = '8c7fd507-…'` (webinar subtree), правило должно иметь `tariff_id='7c748940…'` (BUSINESS) **и** `match_purchase_month=true`. Иначе — `deny` для webinar-модулей.

Это защита «по умолчанию», не требующая чистки legacy-правил. Также **execute требует approval**.

---

## Блок 3. Матрица доступов (10 контактов × 12 вебинар-модулей)

**Источник истины**: `orders_v2` (`status='paid'`, `tariff_id=BUSINESS=7c748940-…`, `meta.source<>'rule_engine'`, `meta.deal_month = content_month`).
**Резолв юзера**: `o.user_id = uid` ИЛИ `o.profile_id = profile_id` (см. найденный баг в RPC ниже).

| Контакт | tariff (active sub) | Expected open | Expected locked | Комментарий |
|---|---|---|---|---|
| `13c5a43d-…` (BUSINESS-15m) | BUSINESS | **12** | 0 | оплачены все 12 вебинар-месяцев |
| `f44409d7-…` (BUSINESS-14m) | BUSINESS | **11** | 1 | не оплачен `2026-04` |
| `8475df88-…` (BUSINESS-13m) | BUSINESS | **9** | 3 | не оплачены `2025-01/02/03` |
| `31f317b3-…` (BUSINESS-8m) | BUSINESS | **3** | 9 | оплачены только 3 пересекающихся месяца |
| `01464367-…` (FULL-1) | FULL | **0** | 12 | FULL не имеет month-gate-правила |
| `05cd3754-…` (FULL-2) | FULL | **0** | 12 | то же |
| `010e895e-…` (CHAT-1) | CHAT | **0** | 12 | CHAT не имеет month-gate-правила |
| `012e765c-…` (CHAT-2) | CHAT | **0** | 12 | то же (даже несмотря на исторические BUSINESS-заказы — не покрыты правилом) |
| `0001fac4-…` (NoSub-1) | — | **0** | 12 | нет активной подписки |
| `bddef8eb-…` (Ирина Тройнич, profile `e3a2744b-…`) | BUSINESS | **3** | 9 | у неё 7 BUSINESS-paid месяцев, но в webinar-модулях есть только 3 пересечения: `2025-10`, `2025-12`, `2026-04` |

### Actual (по текущему коду) — критические находки

#### 🐞 BUG #1 — RPC `has_month_purchase_bulk` не учитывает `profile_id`
```sql
WHERE o.user_id = _user_id
```
Все пользователи, у которых заказы привязаны через `profile_id` (legacy-импорт), **никогда не пройдут month-gate**, даже имея корректные BUSINESS-paid заказы.
- **Affected**: Ирина Тройнич `bddef8eb-…` — Expected 3 open, **Actual 0 open**. То же касается всех контактов из admin_bulk-импорта со старой почтой.
- **Fix (требует approval)**: расширить WHERE на `(o.user_id = _user_id OR o.profile_id IN (SELECT id FROM profiles WHERE user_id = _user_id))`. Изменение — миграция RPC, **execute требует approval**.

#### 🐞 BUG #2 — leaking-правила (см. Блок 2)
Если хоть один пользователь получит entitlement на ghost-продукты `f9e53860/b868013a/84055f12` — Actual для него по 12/1/1 вебинаров будет **open без month-gate**, что нарушает SOT.
- Сейчас owners=0 → Actual = Expected везде, кроме BUG #1.
- Cleanup требует approval.

#### Резюме Expected vs Actual (без фиксов)
| контакт | expected | actual | diff |
|---|---|---|---|
| BUSINESS-15m | 12 | 12 | 0 |
| BUSINESS-14m | 11 | 11 | 0 |
| BUSINESS-13m | 9 | 9 | 0 |
| BUSINESS-8m | 3 | 3 | 0 |
| FULL-1, FULL-2 | 0 | 0 | 0 |
| CHAT-1, CHAT-2 | 0 | 0 | 0 |
| NoSub-1 | 0 | 0 | 0 |
| **Иryna Troynich** | **3** | **0** | **−3 (BUG #1)** |

---

## Блок 4. Кейс «Ирина Тройнич + БкБ как business» (отдельно)

- Все её заказы имеют корректный `meta.deal_month`. Backfill не требуется.
- «Бухгалтерия как бизнес» (`85046734-…`) — это **standalone-продукт**, не Gorbova Club BUSINESS. По правилам **доступ к вебинарам он давать не должен** — и сейчас не даёт (нет правила).
  - Если бизнес хочет, чтобы покупатели «БкБ» видели вебинары — это отдельное business-решение (создание правила), не часть текущего fix.
- Реальная проблема Ирины — BUG #1 (`profile_id` не резолвится в RPC). После фикса RPC она увидит **3 вебинар-модуля** (`2025-10`, `2025-12`, `2026-04`).

---

## Что предлагается выполнить (только после отдельного approval)

1. **Миграция RPC** `has_month_purchase_bulk`: расширить join на `profile_id` через `profiles.user_id`. Affected = все legacy-юзеры.
2. **Cleanup leaking rules**: deactivate `417e5071`, `a377fb0b`, `ecf3e655` (либо решение бизнеса по standalone-бонусам).
3. **Read-path guard** в resolver: webinar subtree → только BUSINESS+month-gate.
4. **Trigger** `orders_v2_autofill_deal_month_trg`: install для будущих заказов.
5. **Retro-rebuild** для всех Club-юзеров после фикса RPC (опц.).

**Все 5 шагов — БЕЗ EXECUTE до отдельной команды.**
