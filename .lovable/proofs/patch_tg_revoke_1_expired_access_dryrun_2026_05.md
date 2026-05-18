# PATCH-TG-REVOKE-1 — Stage 1 read-only preflight proof

**Snapshot источника:** `2026-05-18T12:14:00+00:00`
**Preflight run:** `2026-05-18T12:30:00+00:00`
**Режим:** READ-ONLY. 0 DML. Telegram API не вызывался.

## 1. Scope

- Источник кандидатов: `/mnt/documents/telegram_revoke_reinvite_refresh_sweep_2026_05.csv`
- Фильтр: `gap_class = 'telegram_membership_not_revoked_after_access_expired'` AND `case_status = 'confirmed_bug'`
- Загружено: **185 кандидатов** (185 (user, club) пар).

## 2. Применённые preflight-проверки

Для каждого (user_id, club_id) повторно перепроверено NOW:

1. **active entitlement → club**: `entitlements.status='active' AND (expires_at IS NULL OR expires_at>now())` через `access_rules.grant_target_type='club' AND is_active=true` с матчингом `target_ref=club_id`.
2. **active subscription → club**: `subscriptions_v2.status IN ('active','trial','past_due')` AND `(access_end_at IS NULL OR access_end_at>now())` через тот же access_rules join.
3. **recent grant/reinvite** в `telegram_access_queue` после snapshot (`created_at > '2026-05-18 12:14:00+00'`, status ∈ pending/processing/completed).
4. **already pending revoke** для этой же (user, club).
5. **telegram_user_id известен** (из source CSV).

## 3. Результат

| метрика | значение |
|---|---:|
| Исходные кандидаты | 185 |
| Исключено `access_restored_since_snapshot` | 52 |
| Исключено `recent_grant_or_reinvite_after_snapshot` | 0 |
| Исключено `revoke_already_queued` | 0 |
| Исключено `no_telegram_user_id` | 0 |
| **Final revoke list** | **133** |

F3 / Наталья Морозевич (`tkoffise@gmail.com`): **в final list, 2 строки** (2 разных club_id). ✅

F1 (`katrinkap777@rambler.ru`) / F2 (`alena.gudvilovich@bk.ru`) Telegram-строки: проверены — в когорте confirmed_bug не оказались (их источник проблемы — UI/resolver, не telegram revoke). По правилу из задачи: если бы у них была expired access без platform access — они были бы добавлены, но они не попадают.

## 4. Артефакты

- Final revoke list: `/mnt/documents/patch_tg_revoke_1_final_list_2026_05.csv` (133 rows)
- Excluded: `/mnt/documents/patch_tg_revoke_1_excluded_2026_05.csv` (52 rows, все `access_restored_since_snapshot`)

## 5. Stage 2 plan (execute, ждёт отдельный approve)

Для каждой из 133 строк вставка в `telegram_access_queue`:

```
action      = 'revoke'
user_id     = <row.user_id>
club_id     = <row.club_id>
status      = 'pending'
meta        = {
  "source": "repair",
  "reason": "expired_platform_access_but_still_member",
  "patch": "PATCH-TG-REVOKE-1",
  "snapshot_at": "2026-05-18T12:14:00+00:00",
  "telegram_user_id": <row.telegram_user_id>
}
```

Запреты на execute:
- никаких прямых вызовов Telegram API;
- никаких изменений `telegram_club_members` / `subscriptions_v2` / `entitlements` / `access_rules`;
- никаких изменений secrets/mode;
- только один INSERT batch в `telegram_access_queue`;
- перед каждым INSERT — guard на duplicate (action='revoke' pending/processing same user+club);
- после INSERT — verify rowcount=133, нет дубликатов, F3 присутствует.

## 6. DoD Stage 1

| критерий | статус |
|---|:---:|
| 185 кандидатов перечитаны | ✅ |
| active_platform_access перепроверён | ✅ |
| recent grant/reinvite проверены | ✅ |
| pending revoke dedupe проверен | ✅ |
| telegram_user_id проверен | ✅ |
| Final list собран | ✅ |
| F3 Морозевич в final list | ✅ |
| 0 DML / 0 Telegram API | ✅ |
| Execute не запускался | ✅ |
