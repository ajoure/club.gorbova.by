# ACCESS-FIX-2 dry-run — missing_telegram_access

**Дата:** 2026-05-17 ~14:45 UTC
**Режим:** read-only. БД/Telegram API не трогались.
**Scope:** 9 кейсов `missing_telegram_access` из `h5_access_consistency_audit_after_2026_05_17.md`.

## 1. Правило expectation (SOT)

`tg_expected = true` ⇔ существует `access_rules` с `grant_target_type='club'`, `is_active=true`, `product_id = audit.product_id` И (`tariff_id IS NULL` ИЛИ `tariff_id = sub.tariff_id`).

### Активные club-rules для продуктов кейса

| product_id | product | tariff_id (rule) | club_id | priority | purpose |
|---|---|---|---|---|---|
| `11c9f1b8…` | Gorbova Club | NULL (любой тариф) | `fa547c41…` | 3 | primary |
| `9d0d6de8…` | Платная консультация | `c1b4bb88…` (один конкретный) | `fa547c41…` | 0 | bonus |
| `50ac58f2…` | (другой) | — | — | — | нет правила |
| `73c29914…` | ЗАКРОЙ ГОД | — | — | — | нет правила |

## 2. Пересмотр 9 кейсов (с ФИО и продуктами)

| # | ФИО | email | продукт | sub.tariff_id | access_end_at | tg_expected (SOT) | вывод |
|---|---|---|---|---|---|:---:|---|
| 1 | Тест Тестовый (`@ajoure_ceo`) | 1@ajoure.by | **Gorbova Club** | `31f75673…` | 2026-05-26 | ✅ | true-positive |
| 2 | Тест Тестовый (`@ajoure_ceo`) | 1@ajoure.by | Платная консультация | `1020fce2…` (≠ `c1b4bb88`) | 2026-05-18 | ❌ | **false-positive аудита** (тариф не совпадает с bonus-rule) |
| 3 | Диана Новородская (`@divanka_by`) | 2.lady.di.only@gmail.com | **Gorbova Club** | `7c748940…` | 2026-05-25 | ✅ | true-positive |
| 4 | Татьяна Чаплыгина (`@Tasha_buh`) | a5153253@yandex.by | **Gorbova Club** | `7c748940…` | 2026-06-12 | ✅ | true-positive |
| 5 | Екатерина Иванченко (`@k_ivanchenko`) | finassist.by@gmail.com | **Gorbova Club** | `7c748940…` | 2026-06-02 | ✅ | true-positive |
| 6 | Руслан Цурко (`@navinall`) | gelaev46@gmail.com | Платная консультация | `28eb8dd9…` (≠ `c1b4bb88`) | 2026-05-28 | ❌ | **false-positive аудита** |
| 7 | Катя Осипчик (`@kateosipchik`) | ossiptschik@mail.ru | **Gorbova Club** | `7c748940…` | 2026-06-06 | ✅ | true-positive |
| 8 | Юлия Бурдон (`@bourdon_yuliya`) | pbourdon@tut.by | **Gorbova Club** | `b276d8a5…` | 2026-05-31 | ✅ | true-positive |
| 9 | Андрей Иванович Пилецкий (TG не привязан) | piletski.a@yandex.by | Платная консультация | `f2e999a9…` (≠ `c1b4bb88`) | 2026-05-29 | ❌ | **false-positive аудита** |

**Итог пересмотра:** реальных `missing_telegram_access` = **6**, false-positive = **3** (аудит не учитывал `access_rules.tariff_id` фильтр для bonus-правила).

## 3. Детальная классификация 6 true-positive

Источник фактов: `telegram_club_members` (club_id = `fa547c41…`) + `profiles.telegram_link_status`.

| # | ФИО | email | продукт | tg_member_row | in_chat | in_channel | invite_status | классификация | действие |
|---|---|---|---|:---:|:---:|:---:|---|---|---|
| 1 | Тест Тестовый (`@ajoure_ceo`) | 1@ajoure.by | Gorbova Club | ✅ | false | false | **sent** | `invite_sent_awaiting_user_join` | **не трогать** (ждать join) |
| 3 | Диана Новородская (`@divanka_by`) | 2.lady.di.only@gmail.com | Gorbova Club | ✅ | false | false | **sent** | `invite_sent_awaiting_user_join` | **не трогать** (ждать join) |
| 4 | Татьяна Чаплыгина (`@Tasha_buh`) | a5153253@yandex.by | Gorbova Club | ✅ | false | false | **sent** | `invite_sent_awaiting_user_join` | **не трогать** (ждать join) |
| 5 | **Екатерина Иванченко** (`@k_ivanchenko`) | finassist.by@gmail.com | Gorbova Club | ❌ нет строки | — | — | — | `no_member_row_link_present` | **REINVITE** через canonical writer |
| 7 | **Катя Осипчик** (`@kateosipchik`) | ossiptschik@mail.ru | Gorbova Club | ❌ нет строки | — | — | — | `no_member_row_link_present` | **REINVITE** через canonical writer |
| 8 | **Юлия Бурдон** (`@bourdon_yuliya`) | pbourdon@tut.by | Gorbova Club | ❌ нет строки | — | — | — | `no_member_row_link_present` | **REINVITE** через canonical writer |

У всех трёх «REINVITE»-строк `profile.telegram_link_status='active'` и `telegram_user_id` присутствует — бот привязан, но membership-строки в `telegram_club_members` нет (пропущенная выдача). Это безопасно для reinvite.

### Дополнительно

- **Андрей Иванович Пилецкий** / piletski.a@yandex.by (false-positive по TG): `profile.telegram_link_status = not_linked`, `telegram_user_id` отсутствует. TG не требуется по rule, плюс reinvite невозможен — клиент сам не привязал бота. Не действие ACCESS-FIX-2.

## 4. План execute (после approve)

### 4a. Не трогать (3 строки: #1, #3, #4)
Invite уже отправлен (`invite_status=sent`, last_verified свежий). Это нормальное состояние «приглашение есть, пользователь ещё не нажал». Любая повторная попытка создаст дубль и шум в DM.

### 4b. Reinvite через canonical write-path (3 строки: #5, #7, #8)

Единственный разрешённый путь (см. `canonical-grant-write-path`): `telegram_access_queue` с `meta.source='reinvite'`. Никаких прямых вызовов Telegram API, никаких ручных insert в `telegram_club_members`.

Payload-шаблон на каждую строку:

```sql
INSERT INTO telegram_access_queue (profile_id, club_id, action, meta)
VALUES (
  '<profile_id>',
  'fa547c41-3a84-4c4f-904a-427332a0506e',
  'grant',
  jsonb_build_object(
    'source','reinvite',
    'reason','access_fix_2_missing_telegram_access_2026_05',
    'product_id','11c9f1b8-0355-4753-bd74-40b42aa53616',
    'subscription_id','<sub_id>'
  )
);
```

| # | profile_id (sub.user_id) | telegram_user_id | sub_id |
|---|---|---|---|
| 5 | `a832c11e-1715-4646-bfcb-859fff931a0e` | 143174278 | `28965857-e8ca-41ed-9c5f-87711e884716` |
| 7 | `1bd93a04-4393-41a7-8bb9-166d587686cc` | 8721456902 | `c3657287-18c4-4d94-844e-4496665eddea` |
| 8 | `acd9116c-528f-44c9-9af2-cfe2ba804386` | 556054465 | `6d123c1b-86ed-4a6c-a447-f9f2a4dd2aff` |

Обработка пойдёт через `telegram-process-access-queue → telegram-grant-access`. Stop-условие: при любом `last_error ≠ null` после 1 прогона — вынести в `manual_review`, не повторять.

### 4c. False-positive аудита (3 строки: #2, #6, #9)
Не действие — это уточнение правила в аудит-скрипте. Документировано в этом proof.

## 5. Запреты — соблюдены (dry-run)

- Прямых INSERT/UPDATE в `telegram_club_members` — 0
- Вызовов Telegram Bot API — 0
- UPDATE `subscriptions_v2` / `entitlements` / `access_rules` — 0
- H5 REBILL-orders — не трогались
- Provider API / refunds / secrets / mode — 0
- `grant-access-for-order` — 0

## 6. DoD dry-run

| критерий | done |
|---|:---:|
| Каждый из 9 кейсов классифицирован по SOT-правилу expectation | ✅ |
| 3 false-positive аудита явно помечены | ✅ |
| 3 «invite уже отправлен» отделены от 3 «нужен reinvite» | ✅ |
| План execute использует только canonical write-path (queue + `meta.source='reinvite'`) | ✅ |
| БД и Telegram API не менялись | ✅ |

## 7. Next

Остановка. Ждём approve execute по 3 строкам reinvite (#5, #7, #8).
