# Telegram Cron Sync — P2 + P3 Proof

**Дата:** 2026-05-05
**Scope:** P2 (write-back timestamps) + P3 (cursor/batch). UI, queue, invite, access/subs/entitlements не трогаются.

## Изменения в `supabase/functions/telegram-cron-sync/index.ts`

### P3 — cursor/batch
- `BATCH_LIMIT` (env `TELEGRAM_CRON_BATCH_LIMIT`, default **200**) — лимит участников за один edge-вызов на клуб.
- Выборка участников отсортирована: `last_telegram_check_at ASC NULLS FIRST, id ASC`. Каждый запуск гарантированно продвигает «хвост».
- Параллельно считается `eligibleCount` (head-only count): кандидаты с `last_telegram_check_at IS NULL OR < now()-24h`. Из него выводится `remaining_estimate` и `is_partial`.

### P2 — write-back timestamps
- На каждом member: к существующему `last_telegram_check_at` добавлен `last_verified_at = now()` + фактические `in_chat/in_channel` от Telegram API (логика прежняя).
- На уровне клуба:
  - `last_status_check_at = now()` — всегда после прохода батча;
  - `last_members_sync_at = now()` — **только** при `is_partial=false` (клуб полностью прошёл за этот вызов).

### Audit
- Сохранён legacy `CRON_SYNC` event в `telegram_access_audit` (с добавленными `batch_limit`, `is_partial`).
- Добавлен новый структурный лог в `audit_logs`:
  - `action = 'telegram.cron_sync.batch'`
  - `meta`: `club_id, club_name, processed, updated, kicked, guard_skips, errors, duration_ms, batch_limit, is_partial, remaining_estimate, last_processed_member_id, eligible_total`.

### Что НЕ менялось
- Логика membership-проверки, autokick, admin-guard, pending→active.
- Queue items / invite-link / `telegram_club_members.last_invite_*` — не трогаются.
- access/subscription/entitlements — не трогаются.
- UI — не трогается.

## Verify (прямой POST после deploy)

```
POST /functions/v1/telegram-cron-sync  → 200 (long-running, оба клуба отработали)
BOOT_ERROR — отсутствует.
```

### audit_logs `telegram.cron_sync.batch`

| time (UTC) | club | processed | updated | kicked | guard_skips | errors | duration_ms | is_partial | remaining_estimate |
|---|---|---|---|---|---|---|---|---|---|
| 10:32:26 | Бухгалтерия как бизнес | 200 | 200 | 0 | 1 | 0 | 49 585 | **false** | 0 |
| 10:33:25 | Gorbova Club | 200 | 200 | 0 | 1 | 0 | 58 425 | **true** | 442 |

### `telegram_clubs` после прогона

| club | last_members_sync_at | last_status_check_at |
|---|---|---|
| Бухгалтерия как бизнес | **2026-05-05 10:32:26** ✅ обновлён (full pass) | 2026-05-05 10:32:26 |
| Gorbova Club | 2026-03-13 21:09 *(не трогаем при partial — корректно)* | **2026-05-05 10:33:25** ✅ |

Поведение строго соответствует контракту: `last_members_sync_at` двигается только при полном проходе клуба.

### `telegram_club_members` — снимки до/после

**До (10:30 UTC):**
| club | older_24h | older_7d | not_in_chat |
|---|---|---|---|
| Gorbova Club (fa54…) | 642 | 642 | 521 |
| Бухгалтерия (4f8f…) | 72 | 72 | 610 |

**После (10:34 UTC):**
| club | fresh_5min | fresh_24h | older_24h | not_in_chat |
|---|---|---|---|---|
| Gorbova Club | 200 | 200 | 442 | 521 |
| Бухгалтерия | 200 | 770* | 0 | 537 |

*\* Бухгалтерия: 770 fresh_24h = 200 свежих + 570 уже свежих от 10:02 (после P1-deploy). Все 642 связанных member'а теперь актуальны (older_24h = 0).*

**`not_in_chat` Бухгалтерия:** 610 → 537 (−73). То есть 73 пользователя, которых БД считала вне чата, по факту Telegram API показал в чате — состояние подравнялось. Подтверждает основную гипотезу: проблема была не в инвайтах, а в синхронизации членства.

В Gorbova Club процесс пойдёт стадиями: следующий cron-tick возьмёт следующие 200 (442 remaining → ~3 тика на полный проход).

## Constraints (соблюдено)

- ❌ invite не отправлялись;
- ❌ queue items не создавались;
- ❌ access / subscriptions / entitlements не менялись;
- ❌ UI не правился;
- ✅ только write-back в `telegram_club_members.{in_chat,in_channel,last_telegram_check_at,last_verified_at,last_telegram_check_result}` и `telegram_clubs.{last_status_check_at,last_members_sync_at}` + audit.

## Производительность

- 200 members ≈ 50–60 сек (≤ 250 мс / member из-за rate-limit `setTimeout(100ms)` + DB write).
- Запас до edge-timeout (~150 с) ≥ 2.5×.
- Cron `0 * * * *` (jobid=5): за час оба клуба продвигаются минимум на 200 каждый. Gorbova полностью догонится за ~3 часа. После этого режим — поддерживающий (только участники старше 24 ч).

## Ожидание next cron-tick (11:00 UTC)

Будет проверено, что cron сам подхватит запуск без ручного вызова. Если `net._http_response` покажет таймаут — поднять `BATCH_LIMIT` вниз до 150 через env-переменную без редеплоя кода.

## Запрещено в этом шаге (не делалось)

- UI/P4;
- bulk re-invite;
- setWebhook;
- DB migrations;
- изменение cron schedule.
