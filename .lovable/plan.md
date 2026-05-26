План v2: фантомные recurring-признаки на one-time продуктах + восстановление Gorbova Club у `elizaveta.andreeva.15@yandex.by`

> Терминология: **это не «удаление подписок» и не «отмена доступов».** Это **очистка фантомных recurring-признаков** (`auto_renew`, `next_charge_at`, `meta.recurring_snapshot/recurring_amount/recurring_currency`) у подписок на one-time продуктах, у которых SOT (`tariff_offers.meta.recurring.is_recurring`) = NULL/false. `status`, `access_start_at`, `access_end_at`, `tariff_id`, `product_id`, `order_id`, `billing_type`, `entitlements`, `access_rules`, telegram-доступы — **НЕ меняются**.

---

## 1. Diagnose (read-only, уже выполнено)

Контакт `692f22b7-…`, Елизавета Андреева. Видимая «странная» карточка — это **две разные подписки**:

### A. Карточка «ЗАКРОЙ ГОД — Стандартный» (sub `b2c8d37a-…`)
- product=`73c29914` (ЗАКРОЙ ГОД), tariff=`56c35e86` (Стандартный)
- `status=active`, `auto_renew=true`, `billing_type=mit`, `next_charge_at=2026-05-31 23:59`
- `meta.recurring_snapshot.is_recurring=true`, `recurring_amount=230 BYN`
- SOT по `tariff_offers` для ЗАКРОЙ ГОД/Стандартный (offer `53f05940`, active pay_now): `amount=900`, `meta.recurring=NULL` → **продукт one-time, не recurring** → нарушение `Product Type SOT`, `Auto-Renewals Cohort SOT`, `Recurring Snapshot Resolver SOT`.

### B. Реальная Gorbova Club / BUSINESS (sub `b1676866-…`)
- product=`11c9f1b8` (Gorbova Club), tariff=`7c748940` (BUSINESS)
- `status=canceled`, `auto_renew=false`, `billing_type=provider_managed`
- `meta.bepaid_cancel_source=user_card_change` (06.05.26 16:01), `resumed_at=06.05.26 16:07`, `resumed_by_user=true`
- bePaid sub `sbs_e600f8c4f50d1a56` — нужно явно проверить статус у провайдера (см. §6).
- entitlement Gorbova Club (`412be761…`) активен до 05.06.26; в meta `source=user_resume`, `tariff_name=BUSINESS`, **нет** `source_rule_id`/`business_subscription_id` → UI рисует «доступ по продукту» без бейджа.

## 2. Масштаб фантомных recurring-признаков (one-time продукты)

`status ∈ {active, past_due, trial}` и (`auto_renew=true` OR `next_charge_at IS NOT NULL` OR `meta.recurring_snapshot.is_recurring=true`):

| Продукт | Тариф | Всего | auto_renew | next_charge_at | snap.is_recurring |
|---|---|---|---|---|---|
| ЗАКРОЙ ГОД | Стандартный | 77 | 68 | 76 | 74 |
| Подоходный налог ИП | стандарт | 10 | 0 | 10 | 1 |
| Платная консультация | Срочная консультация | 2 | 0 | 2 | 1 |
| Платная консультация | Помощь при проверке | 1 | 0 | 1 | 1 |

Итого — **90 фантомных строк** на 4 one-time продуктах.

---

# Трек 1. Cleanup фантомных recurring-признаков (массово)

Треки 1 и 2 **выполняются отдельно**. Сначала — Трек 1 целиком, затем отдельным решением — Трек 2 по Елизавете.

## 1.1 Что меняем / что НЕ меняем

Меняем только в `subscriptions_v2`:
- `auto_renew → false`
- `next_charge_at → NULL`
- `meta.recurring_snapshot` → удалить
- `meta.recurring_amount`, `meta.recurring_currency` → удалить
- `meta.phantom_recurring_cleanup` = `{ at, reason, source_patch, backup_table, backup_row_id }`
- `payment_token` — **в первом execute НЕ трогаем** (см. §1.4). Отдельный второй проход с guard, только если останутся фантомные локальные MIT-токены без `payment_methods`/`card_profile_links`.

НЕ трогаем: `status`, `access_start_at`, `access_end_at`, `tariff_id`, `product_id`, `order_id`, `billing_type`, `entitlements`, `access_rules`, `telegram_access_queue`, `provider_subscriptions`, bePaid.

## 1.2 Выборка (включая обязательные STOP-guards)

Кандидат проходит cleanup, только если ВСЕ условия выполнены:

1. Продукт **НЕ** в `recurring_products`:
   ```
   recurring_products = SELECT DISTINCT t.product_id
     FROM tariff_offers o JOIN tariffs t ON t.id=o.tariff_id
     WHERE o.is_active AND o.offer_type='pay_now'
       AND (o.meta->'recurring'->>'is_recurring')::bool = true
   ```
2. `status ∈ {active, past_due, trial}`.
3. Есть хотя бы один phantom-флаг: `auto_renew=true` OR `next_charge_at IS NOT NULL` OR `(meta->'recurring_snapshot'->>'is_recurring')::bool = true`.
4. **STOP-guard A (provider_subscriptions):** нет ни одной записи в `provider_subscriptions` для этой `subscription_v2_id` со `state ∈ {active, pending, trial}`. Если есть — `manual_review`, не трогаем.
5. **STOP-guard B (provider link in meta):** `meta->>'bepaid_subscription_id' IS NULL` и `meta->>'provider_subscription_id' IS NULL`. Иначе — `manual_review`.
6. **STOP-guard C (billing_type):** `billing_type = 'mit'` (или NULL). Если `billing_type='provider_managed'` среди 90 — STOP, отдельный manual_review-список.
7. **STOP-guard D (идемпотентность):** `meta->'phantom_recurring_cleanup' IS NULL`.

Любая строка, отсеянная guard-ом A/B/C, попадает в отдельный отчёт `phantom_recurring_v1.manual_review` и **не** меняется этим патчем.

## 1.3 Backup & Rollback (обязательно перед UPDATE)

Создаём backup-таблицу (миграция, не data):
```
phantom_recurring_cleanup_backup_2026_05 (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  before_auto_renew boolean,
  before_next_charge_at timestamptz,
  before_payment_token text,
  before_meta jsonb not null,    -- полный meta до правки
  after_meta_diff jsonb,         -- что именно убрали
  cleaned_at timestamptz default now(),
  source_patch text default 'phantom_recurring_v1'
)
```
- Перед UPDATE для каждой целевой строки делаем INSERT в backup.
- В `meta.phantom_recurring_cleanup.backup_row_id` пишем id backup-строки.
- Дополнительно сохраняем sweep-snapshot (все 90 строк целиком) в `audit_logs` action `phantom_recurring_v1.preflight_snapshot` (через canonical evidence-relay/audit write-path).

Rollback SQL (готовим заранее, кладём в proof):
```sql
UPDATE subscriptions_v2 s
SET auto_renew     = b.before_auto_renew,
    next_charge_at = b.before_next_charge_at,
    payment_token  = COALESCE(b.before_payment_token, s.payment_token),
    meta           = b.before_meta
FROM phantom_recurring_cleanup_backup_2026_05 b
WHERE b.subscription_id = s.id
  AND b.source_patch = 'phantom_recurring_v1';
```
Rollback тоже идемпотентный (можно гонять повторно).

## 1.4 Payment token policy

`payment_token` в первом execute **не очищаем**. Причины:
- Часть локальных токенов до сих пор может быть связана с активной картой через `payment_methods` / `card_profile_links` и использоваться для платных продуктов клиента в других местах.
- Безопасный путь: сначала отдельный read-only диагноз — для каждой строки из 90 пометить:
  - `phantom_only` — `payment_token` ни в одной активной `payment_methods`/`card_profile_links` не используется И нет live `provider_subscriptions`;
  - `shared` — токен/карта живут в других местах → не трогаем.
- Только `phantom_only` могут пойти во второй проход с обнулением `payment_token`. Этот второй проход — отдельный patch, не в этом плане.

## 1.5 Порядок исполнения (Trek 1)

1. **Diagnose:** SELECT по §1.2, выгрузка в `audit_logs` (`phantom_recurring_v1.preflight`, `snapshot.total_rows=90` per Discovery Evidence Canon).
2. **Manual-review split:** отдельный отчёт `phantom_recurring_v1.manual_review` со строками, отсеянными guards A/B/C (ожидаем 0, но обязательно проверить).
3. **Migration:** создать `phantom_recurring_cleanup_backup_2026_05` + индекс по `subscription_id`.
4. **Dry-run:** на одной строке `b2c8d37a` показать diff `before/after` и работу rollback.
5. **Execute:** одной транзакцией — для каждой целевой строки: INSERT в backup → UPDATE в `subscriptions_v2`. Идемпотентно через guard D.
6. **Audit:** `phantom_recurring_v1.executed` с количеством, перечнем id, ссылкой на backup-table.

## 1.6 Verify (Trek 1)

- SELECT из §1.2 = **0 строк**.
- Nightly invariant `inv_phantom_recurring_v1` (новый): `count(*) FROM § = 0`. Добавить в существующий nightly health-check.
- Спот-чек `b2c8d37a`:
  - карточка «Подписки» в `ContactDetailSheet` больше **не** показывает «Следующее списание» и не помечается как auto-renew;
  - карточка/строка доступа до 31.05.26 **остаётся** (entitlement `757976ea` не тронут);
- Спот-чек: ни одна `subscriptions_v2` с продуктом из `recurring_products` (Gorbova Club, Бизнес-курсы, и т. п.) не изменена — diff по списку id из backup-table пуст для recurring-продуктов.
- В `audit_logs` присутствует `phantom_recurring_v1.executed` со счётчиком, равным количеству строк в backup-table.

## 1.7 Definition of Done (Trek 1)

- Backup-table создана и заполнена ровно по количеству изменённых строк.
- Rollback SQL приложен к proof и валидирован на dry-run.
- Verify §1.6 пройден полностью.
- Никаких изменений в Track 2 артефактах (entitlement Gorbova Club, sub `b1676866`, bePaid) этим патчем не сделано.

---

# Трек 2. Восстановление видимости Gorbova Club / BUSINESS у Елизаветы

**Не смешиваем с Trek 1.** Запускается отдельным сообщением после Verify Trek 1.

## 2.1 Read-only eligibility (обязательно перед любым действием)

До любого resume / правки meta — собрать чистый snapshot:

1. **Card state:** есть ли у Елизаветы активная карта в `payment_methods` (status='active', provider_token IS NOT NULL). По скриншоту VISA 7414 — да, но подтвердить из БД.
2. **Provider state (живой запрос):** дернуть `bepaid-get-subscription-details` (admin-only) по `sbs_e600f8c4f50d1a56`. Ожидаем: 404 или canceled/terminated. Зафиксировать ответ в proof.
3. **Local state:** `subscriptions_v2.b1676866.status=canceled, auto_renew=false`. Подтвердить.
4. **Split-brain risk:** убедиться, что для product=Gorbova Club + tariff=BUSINESS + user=Елизавета нет другой active/past_due `subscriptions_v2`, кроме `b1676866`. Если есть — STOP, manual_review.
5. **Canonical check-resume:** вызвать `subscription-actions action=check-resume` по `b1676866`. Ожидаемый результат при provider dead: `resume_available=false, reason='provider_dead'`.

Эти 5 пунктов идут в proof как «Track 2 — read-only eligibility».

## 2.2 Варианты решения (выбирает пользователь после §2.1)

- **2a) Косметика без resume.** Дополнить `entitlements.412be761.meta` полями `business_subscription_id=b1676866` и/или подходящим `source_rule_id`, чтобы UI показал бейдж «через BUSINESS». Подписка `b1676866` остаётся canceled. Автопродления **нет**.
- **2b) Canonical resume.** Вызвать `subscription-actions action=resume` по `b1676866`. По правилу `Resume 3-Level Eligibility SOT`, если provider dead, backend вернёт `resume_blocked_provider_dead`, в UI появится CTA «Оформить новую подписку». **Никаких ручных INSERT** в `subscriptions_v2`/`provider_subscriptions`. Если внезапно provider жив — будет полноценный resume с audit `subscription.resumed`.
- **2c) Явное завершение без действий.** Оставить как есть; доступ дожить до 05.06.26 через entitlement; 06.06 — стандартный nightly reconcile закроет visibility. Без UI-изменений.
- **2d) UX-honest (по умолчанию рекомендуется):** не пытаться resume, а явно показать в UI Елизаветы: «Подписка завершена; доступ активен до 05.06.26; для продолжения — оформить новую подписку Gorbova Club / BUSINESS». Реализуется как UI-flag в карточке без правок данных: либо через бейдж на entitlement, либо через рендер canceled-sub `b1676866` отдельным «historical» блоком с deeplink на оформление нового. Никаких изменений в `subscriptions_v2`/`bePaid`. Самый честный вариант при `provider_dead` + есть активная карта.

Запреты по обоим вариантам:
- НЕ создаём руками `subscriptions_v2` или `provider_subscriptions` (Canonical Write Path, Provider-Linked Extend Priority).
- НЕ ставим `auto_renew=true` на canceled-запись.
- НЕ вызываем bePaid `/subscriptions` за клиента без явного его подтверждения через canonical resume/checkout.

## 2.3 Definition of Done (Trek 2)

- В proof зафиксирован read-only snapshot §2.1 (card, provider, local, split-brain, check-resume).
- Зафиксирован выбранный вариант 2a/2b/2c/2d и его audit.
- Доступ Елизаветы к Gorbova Club не уменьшен (минимум до 05.06.26).
- Никаких изменений в данных подписок других пользователей.

---

## 3. Proof (структура отчёта)

Отчёт оформляется двумя разделами, **раздельно**:

### Track 1 — executed
- `phantom_recurring_v1.preflight` snapshot (90 rows).
- `phantom_recurring_v1.manual_review` (ожидаемо 0; иначе — отдельный список).
- Миграция backup-table.
- Dry-run diff для `b2c8d37a`.
- `phantom_recurring_v1.executed` с count и id-list.
- Verify §1.6: SQL-чек = 0, nightly invariant добавлен, спот-чек `b2c8d37a`, проверка нетронутых recurring-продуктов.
- Готовый rollback SQL.

### Track 2 — decision only / executed separately
- Read-only eligibility snapshot Елизаветы §2.1 (card, provider 404/canceled, local state, split-brain check, check-resume output).
- Выбранный вариант 2a/2b/2c/2d + причина.
- Если что-то сделано — отдельный audit-event и diff.

---

## 4. Что подтвердить перед Execute

1. Согласие на Trek 1 c **backup-table + STOP-guards A/B/C/D + payment_token не трогаем в первом execute**.
2. Согласие, что Trek 2 запускается **отдельно** после Verify Trek 1 и начинается с read-only eligibility, без предвыбранного варианта.
3. По умолчанию по Trek 2 предлагается **2d** (UX-honest) — если читать «provider dead, карта жива, доступ до 05.06.26», это самый честный вариант для клиента; 2b как альтернатива, если хочется именно canonical resume-аудит.