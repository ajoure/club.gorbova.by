# ACCESS-FIX-2 execute — missing_telegram_access (3 reinvite)

**Дата:** 2026-05-17 ~14:59 UTC
**Scope:** ровно 3 INSERT в `telegram_access_queue` с `meta.source='reinvite'`.
**Write-path:** canonical queue (см. `canonical-grant-write-path`). Без прямого Telegram API, без `grant-access-for-order`, без ручных insert в `telegram_club_members`.

## Результат INSERT

| # | ФИО | email | TG | продукт | queue_id | user_id | club_id | sub_id | action | status | source |
|---|---|---|---|---|---|---|---|---|:---:|:---:|:---:|
| 1 | Екатерина Иванченко | finassist.by@gmail.com | `@k_ivanchenko` | Gorbova Club | `a998ee52-c2dc-453b-8f37-02436f74bfae` | `a832c11e…` | `fa547c41…` | `28965857…` | grant | pending | reinvite |
| 2 | Катя Осипчик | ossiptschik@mail.ru | `@kateosipchik` | Gorbova Club | `4ae77160-cedc-4f41-b2ab-c3f17bcf0697` | `1bd93a04…` | `fa547c41…` | `c3657287…` | grant | pending | reinvite |
| 3 | Юлия Бурдон | pbourdon@tut.by | `@bourdon_yuliya` | Gorbova Club | `86b089cb-cdb9-42fd-b963-70a1047955a7` | `acd9116c…` | `fa547c41…` | `6d123c1b…` | grant | pending | reinvite |

`meta`: `{source:'reinvite', reason:'access_fix_2_missing_telegram_access_2026_05', product_id:'11c9f1b8…', email, full_name}`.

## Verify

| критерий | результат |
|---|:---:|
| Создано ровно 3 записи в `telegram_access_queue` (за последние 5 минут) | ✅ |
| У всех 3 `meta.source='reinvite'` | ✅ |
| У всех 3 `action='grant'`, `status='pending'` | ✅ |
| Нет новых записей по 3 «invite_sent_awaiting_user_join» (Тест Тестовый / Диана Новородская / Татьяна Чаплыгина) | ✅ |
| Нет новых записей по 3 false-positive (1@ajoure.by×ПК, gelaev46×ПК, piletski.a×ПК) | ✅ |
| Прямых вызовов Telegram Bot API из этого execute — 0 | ✅ |
| `grant-access-for-order` не вызывался | ✅ |
| `subscriptions_v2` / `entitlements` / `access_rules` / `provider_subscriptions` / `telegram_club_members` НЕ изменялись | ✅ |
| Source-guard (`reinvite ∈ allowed`) пропустит item в `telegram-process-access-queue` | ✅ (см. `canonical-grant-write-path`) |

SQL-проверка (за окно 5 минут):
```
SELECT count(*) FROM telegram_access_queue
 WHERE created_at > now() - interval '5 minutes';
-- => 3
```

## Не тронуто (по решению)

| группа | строки |
|---|---|
| invite_sent_awaiting_user_join | Тест Тестовый (1@ajoure.by), Диана Новородская (2.lady.di.only@gmail.com), Татьяна Чаплыгина (a5153253@yandex.by) |
| false-positive (TG по rule не положен) | Тест Тестовый × Платная консультация, Руслан Цурко × ПК, Андрей Иванович Пилецкий × ПК |

## DoD

- ✅ Только canonical queue path (`meta.source='reinvite'`)
- ✅ 3/3 reinvite поставлены в pending, ожидают `telegram-process-access-queue`
- ✅ Никаких параллельных модификаций таблиц доступа
- ✅ Stop-условие: если после 1 прогона `last_error ≠ null` — переводим в `manual_review`, не повторяем

## Финальный статус кампании

- **ACCESS-FIX-1:** 4 fixed, 2 intentionally unresolved
- **ACCESS-FIX-2:** 3 reinvite queued, 6 no-action
