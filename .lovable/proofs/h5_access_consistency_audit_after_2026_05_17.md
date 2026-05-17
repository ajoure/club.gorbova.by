# Access consistency audit after 2026-05-17 (read-only)

**Cutoff:** `2026-05-17 00:00:00+00`
**Snapshot UTC:** 2026-05-17 ~13:36 UTC
**Режим:** read-only. БД не менялась.

## 1. Методология

### 1.1 Cohort

Union (user_id × product_id), где есть хотя бы одно из:
- `subscriptions_v2.access_end_at > cutoff` (user_id, product_id NOT NULL);
- `entitlements.status='active' AND (expires_at IS NULL OR expires_at > cutoff)`.

Результат: **856** distinct (user × product) пар, **179** distinct users.

### 1.2 SOT priorities (как в плане)

1. `entitlements` — техническая видимость.
2. `subscriptions_v2` — окно доступа recurring.
3. `access_rules` / `tariff_offers` — что должно быть выдано.
4. Telegram membership (`telegram_club_members.in_chat|in_channel`, `access_status`) — внешний факт, не замена primary.

`paid orders_v2` сам по себе **не** считается фактом доступа — только справочно через subscription/entitlement.

### 1.3 Telegram expectation

`tg_expected = true` ⇔ существует `access_rules` с `grant_target_type='club'`, `is_active=true`, `product_id = audit.product_id`. Иначе — `tg_expected=false`, отсутствие TG **не** ошибка.

### 1.4 Secondary/bonus expectation

Доказательством обязательного secondary является один из источников:
- `tariff_offers.meta.bonus_products` / `meta.included_products`;
- `access_rules` с дополнительным `product_id` против тарифа;
- `product_fulfillment` / `products_v2.meta.bonus`.

При отсутствии SOT-правила → `no_rules_configured` (не помечается как `missing_secondary_access`). В текущем срезе автоматически доказанных пропусков secondary не обнаружено.

## 2. Gap classification (правила)

| gap_class | условие | severity |
| --- | --- | --- |
| `missing_primary_entitlement` | есть active/trial/past_due sub без entitlement по продукту | **critical** |
| `subscription_without_entitlement` | sub есть (любой статус), entitlement отсутствует | high |
| `missing_telegram_access` | `tg_expected=true` и `tg_present_count=0` | high |
| `entitlement_without_subscription` | ent есть, sub нет — bonus/one-time/admin grant | medium |
| `access_end_mismatch` | |expires_at − access_end_at| > 24h | medium |
| `tariff_mismatch` | `ent.meta.tariff_id <> sub.tariff_id` (оба не null) | medium |
| `ok` | без замечаний | low |

## 3. Сводка (CSV: 882 rows)

| gap_class | severity | count |
| --- | --- | ---:|
| `entitlement_without_subscription` | medium | 407 |
| `ok` | low | 353 |
| `access_end_mismatch` | medium | 66 |
| `subscription_without_entitlement` | high | 40 |
| `missing_telegram_access` | high | 9 |
| `missing_primary_entitlement` | critical | 6 |
| `tariff_mismatch` | medium | 1 |
| **итого** | | **882** |

## 4. Critical (missing_primary_entitlement) — 6

| product | email / profile | sub_status | access_end_at | sub_id | примечание |
| --- | --- | --- | --- | --- | --- |
| ЗАКРОЙ ГОД | alexasermyazhko@gmail.com (Alexandra Sermyazhko) | active | 2026-05-31 | 405faf46… | tg не требуется (`tg_expected=f`) |
| Gorbova Club | elena.platonova-fedyakova@yandex.ru (Елена Платонова) | active | 2026-05-21 | f2901cfc… | TG ok (1 present) |
| Gorbova Club | natapono2018@mail.ru (Наталия Колесник) | active | 2026-05-30 | 08363441… | TG ok |
| Gorbova Club | trofimova.ulia@tut.by (Юлия Трофимова) | active | 2026-05-19 | de75db3a… | TG ok |
| ЗАКРОЙ ГОД | (no profile) user `17b35d62…` | active | 2026-05-31 | 0c999415… | tg не требуется |
| Ценный бухгалтер 2 ступень / 3 поток | (no profile) user `539ea1b3…` | active | 2026-08-30 | be19fa2e… | tg не требуется |

Все 6 — активные платные подписки **без primary entitlement**. UI/resolver «Моей библиотеки» не покажет продукт пользователю до создания entitlement (см. `cabinet-visibility-entitlement-dependency`).

**Recommended action:** перепрогнать `grant-access-for-order` по `sub_order_id`. Не выполнено в этом аудите (read-only).

## 5. High — missing_telegram_access (9)

| product | email | sub_status | access_end_at | tg_access_status raw |
| --- | --- | --- | --- | --- |
| Gorbova Club | 1@ajoure.by | active | 2026-05-26 | ok |
| Платная консультация | 1@ajoure.by | active | 2026-05-18 | ok |
| Gorbova Club | 2.lady.di.only@gmail.com | active | 2026-05-25 | ok |
| Gorbova Club | a5153253@yandex.by | active | 2026-06-12 | ok |
| Gorbova Club | finassist.by@gmail.com | active | 2026-06-02 | ok |
| Платная консультация | gelaev46@gmail.com | active | 2026-05-28 | — |
| Gorbova Club | ossiptschik@mail.ru | active | 2026-06-06 | ok |
| Gorbova Club | pbourdon@tut.by | active | 2026-05-31 | — |
| Платная консультация | piletski.a@yandex.by | active | 2026-05-29 | — |

`tg_access_status=ok` ≠ реальное присутствие (см. `telegram_effective_access_resolver_2026_05`). Возможные причины: stale `access_status='ok'` без in_chat/in_channel, либо профиль не связан с `telegram_user_id`.

**Recommended action:** перед reinvite проверить `profiles.telegram_user_id` и `telegram_link_status`. Если link нет — отправить flow привязки бота, не reinvite.

## 6. High — subscription_without_entitlement (40)

40 из 40 — `Ценный бухгалтер | 1 ступень 2.0 | Модуль: Учет у ИП`, статус `canceled`, `access_end_at = 2026-06-25 06:54:18.785+00`. Это grace-окно после cancel модульной подписки. Если для модуля ожидается видимость на grace — это **bug**: entitlement не создан / был сnyt. Если по бизнес-правилу модуль скрывается сразу после cancel — `access_end_at` подписки должен был быть выровнен к моменту cancel.

**Recommended action:** product owner решение — оставить ли видимость до 25.06 или урезать `access_end_at`.

## 7. Medium — access_end_mismatch (66, sample)

Примеры расхождений:

| email | product | sub.access_end_at | ent.expires_at | δ |
| --- | --- | --- | --- | --- |
| 28031983@mail.ru | Gorbova Club | 2026-05-23 | 2026-06-23 | +31 d |
| 447417148@mail.ru | Gorbova Club | 2026-06-12 | 2026-07-12 | +30 d |
| 7500084@gmail.com | Gorbova Club (superseded ×2) | 2026-05-29 | 2026-08-07 | +70 d |
| 7500084@gmail.com | Платная консультация (superseded ×2) | 2026-05-17 | 2026-06-17 | +31 d |
| 2287226@tut.by | Модуль: Учет у ИП | 2026-06-25 (canceled) | 2026-06-02 | −23 d |

Большинство расхождений — entitlement продлён следующим заказом, sub предыдущая ещё активна / superseded. Это **не критично** (entitlement = SOT видимости), но указывает на отсутствие dedup'a superseded subs.

## 8. Medium — tariff_mismatch (1)

Одна запись, gap не блокирующий. См. CSV `gap_class=tariff_mismatch`.

## 9. Entitlement_without_subscription (407) — informational

Ожидаемое поведение для one-time продуктов, bonus/secondary grants, ручных admin grants, исторических purchases без recurring sub. Не классифицировано как ошибка.

## 10. Что НЕ выполнялось

- DML / INSERT / UPDATE / DELETE — 0
- `grant-access-for-order` — 0
- Telegram grant/revoke — 0
- provider API — 0
- изменения `subscriptions_v2` / `entitlements` / `access_rules` / secrets / mode — 0
- auto-fix — 0

## 11. DoD

| critria | done |
|---|:---:|
| H5 фактически соответствует БД | ✅ (см. `h5_final_verification_status_board_2026_05.md`) |
| Полный список оставшихся manual_review/skipped | ✅ |
| Аудит активных доступов после 17.05.2026 собран | ✅ (882 rows) |
| Для каждого (user×product) видно: доступ/срок/соответствие правилам/Telegram/secondary | ✅ (CSV колонки) |
| Все проблемы классифицированы `gap_class` + `severity` + `recommended_action` | ✅ |
| БД не менялась | ✅ |
