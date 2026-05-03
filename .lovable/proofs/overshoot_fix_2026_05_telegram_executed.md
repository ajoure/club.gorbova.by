# Overshoot fix 2026-05 — Telegram notifications executed

**Дата:** 2026-05-03
**Snapshot:** `_inv22_overshoot_snapshot` snapshot_id `f7fa1fe8-5f58-4894-a95e-de8ef027e3a0`
**Cutoff:** 2026-05-02 19:12:30 UTC
**Source:** manual one-shot via `/tmp/send_overshoot.ts` (Telegram Bot API direct)

## Recipients (sent)

| # | email | subscription_id | telegram_user_id | message_id | was (Минск) | стало (Минск) |
|---|---|---|---|---|---|---|
| 1 | 6972333@mail.ru | aa5cb927-22d8-4575-afc8-0b55d08ad0fa | 452601975 | 17986 | 04.05 23:59 | 04.05 22:30 |
| 2 | lena_times@mail.ru | 8a880ae9-6480-4c2e-a8fe-0939405ccd29 | 853499442 | 17987 | 03.05 23:59 | 03.05 14:32 |

## Excluded

- **n.novikova109@gmail.com** (`1181772d…`): новый succeeded payment 2026-05-03 07:00:43 по parent order `e4c429ed` (bsub `sbs_76f63b3790b9577a`), `subscriptions_v2.access_end_at` корректно продлён до 2026-06-02. Overshoot отсутствует — реальное продление.

## Results

- sent: **2**
- failed: **0**
- skipped: **0**
- audit count `overshoot_fix_2026_05.telegram_notified`: **2**
- telegram_messages mirror rows: **2** (для отображения в карточке контакта)
- idempotency_key: `overshoot_fix_2026_05:{subscription_id}:telegram`

## Repeat dry-run (after send)

Из 30-строчной базы snapshot (Бухгалтерия, telegram_user_id NOT NULL):
- already_notified: 2 ✅ (idempotency сработал)
- остаются с дельтой ≥60s между live_end_at и correct_end_at: **4 строки**
  - n.novikova109 — есть новый платёж после snapshot (исключена legitimately)
  - **nika.1900735@mail.ru** (`052126fb…`) — live 05.05 23:59 vs correct 05.05 10:15
  - **perevoznikovan@gmail.com** (`cfd7c8d8…`) — live 07.05 23:59 vs correct 07.05 14:15
  - **slmmls@mail.ru** (`8d2a7227…`) — live 05.05 23:59 vs correct 05.05 15:38

⚠️ Эти 3 строки в первом preflight попали в `excluded_already_correct` (27 строк), но при повторном dry-run снова видны как overshoot. Требует отдельного решения пользователя — не уведомлены.

## Permanent guard

Постоянный guard от overshoot уже встроен в `bepaid-webhook` — см. memory `bepaid active_to Overshoot Guard`. One-shot скрипт `/tmp/send_overshoot.ts` ephemeral, в проекте не сохраняется.
