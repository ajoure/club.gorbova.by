Да, согласен, с учетом правок:

```text
План PATCH-TG-DISCOVERY-FULL + non-Telegram follow-up подтверждаю.

Выполняй строго read-only по двум трекам.

Ключевые уточнения:

1. Telegram revoke на 133 НЕ выполнять.
Старый список revoke считается подозрительным и не используется как execute-SOT.

2. В Telegram discovery главным SOT считать не queue/audit/invite, а актуальную связку:
- active entitlement / active subscription;
- access_rules продукта к конкретному club_id;
- фактическое membership: in_chat / in_channel;
- актуальный telegram_user_id.

3. По двум основным Telegram-клубам обязательно дать отдельные сводки:
- Gorbova Club: expected members / actual in_chat / actual in_channel / revoke_needed / reinvite_needed.
- Бухгалтерия как бизнес: expected members / actual in_chat. Channel не учитывать как ошибку, если по конфигурации доступ только в чат.

4. Если revoke_needed снова получится большим:
- НЕ предлагать execute;
- дать причину, почему список большой;
- показать топ-причины: expired product, canceled subscription, missing entitlement, stale membership, wrong club mapping.

5. F3 Наталья Морозевич — обязательный контрольный кейс.
Нужно явно указать:
- по какому club_id есть проблема;
- должна ли она быть в чате/канале;
- где она фактически находится;
- нужен revoke / no-action / manual_review.

6. По non-Telegram:
F1/F2 не закрывать как false-positive без UI/resolver проверки.
Если SQL показывает доступ, но UI проверить нельзя — статус только `sql_ok_ui_not_verified`.

7. Для F1/F2 обязательно определить источник проблемы:
- data gap;
- access_rules gap;
- product_fulfillment gap;
- ui_resolver gap;
- mixed;
- no_action/by_design.

8. G1/G10/G14, где нужен реальный UI/resolver output, не считать подтверждёнными багами только по SQL.
Если impersonation/resolver не доступен — `not_testable_sql_only`.

9. Execute не запускать.
Никаких INSERT в telegram_access_queue, никаких grant-access-for-order, никаких DML.

Artifacts:
- `.lovable/proofs/telegram_full_access_discovery_2026_05.md`
- `/mnt/documents/telegram_full_access_expected_vs_actual_2026_05.csv`
- `/mnt/documents/telegram_full_access_summary_2026_05.csv`
- `/mnt/documents/telegram_revoke_candidates_verified_2026_05.csv`
- `.lovable/proofs/audit_ideology_business_non_telegram_followup_2026_05.md`
- обновлённый `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv`, если потребуется.

После завершения:
- отдельно дать вывод по Telegram: сколько ok / revoke / reinvite / refresh / manual_review;
- отдельно дать вывод по F1/F2 и non-Telegram: что data-gap, что UI/resolver-gap, что by design;
- остановиться и ждать approve на следующий patch.

План: PATCH-TG-DISCOVERY-FULL + non-Telegram follow-up (read-only)
```

## STOP

PATCH-TG-REVOKE-1 Stage 2 execute — НЕ approve. Список 133 revoke считаем подозрительным: вероятно собран по устаревшим membership/audit/queue строкам, без сверки с актуальным SOT и без учёта chat vs channel конфигурации клуба.

Telegram-блок замораживается до полного завершения PATCH-TG-DISCOVERY-FULL. Параллельно идёт non-Telegram follow-up.

---

## Трек 1 — PATCH-TG-DISCOVERY-FULL (read-only, execute запрещён)

### Stage 1 — Telegram clubs inventory

- Из `telegram_clubs` + связанных `access_rules` (`grant_target_type='club'`, `is_active=true`) собрать: `club_id`, `product_id`, `product_name`, `chat_id`, `channel_id`, `title`, `is_active`, `access_mode`, список access_rules, требуется ли chat/channel/both.
- Отдельно зафиксировать Gorbova Club и «Бухгалтерия как бизнес» с их chat_id/channel_id и продуктовой привязкой.

### Stage 2 — Actual Telegram membership

По каждому клубу из `telegram_club_members` (+ join `profiles`/`auth.users` по telegram_user_id/profile_id):

- user/profile, email, telegram_user_id, username, in_chat, in_channel, access_status, last_verified_at, source, updated_at.
- Агрегаты на клуб: total rows, in_chat=true, in_channel=true, access_status='ok', stale (last_verified_at старше N дней), без telegram_user_id.

### Stage 3 — Expected access SOT

Для каждого (user, club) определить ожидаемый доступ строго по приоритету:

1. active entitlement по product_id клуба (`status='active'`, `expires_at IS NULL OR > now()`);
2. active/trial/past_due subscription с `access_end_at > now()` по product_id/tariff_id клуба;
3. paid order_v2 с действующим окном доступа;
4. access_rules как маппинг продукта → club (но НЕ как источник права);
5. явный admin/manual grant только если активен.

Не учитывать как активный доступ: expired/canceled/superseded без entitlement; старые invite_sent; старые queue rows; `telegram_club_members.access_status` без platform access; исторические audit_logs.

### Stage 4 — Expected vs actual matrix

Таблица user × club с колонками: customer, email, telegram username, club_name, expected_access, expected_chat, expected_channel, actual_in_chat, actual_in_channel, actual_access_status, active_entitlement_id, active_subscription_id, entitlement_expires_at, subscription_access_end_at, access_rule_id, decision, reason.

Decision только из: `ok_keep_access`, `revoke_needed`, `reinvite_needed`, `refresh_status_needed`, `no_action_no_access_and_not_member`, `manual_review_conflicting_data`, `telegram_not_linked_by_user`.

### Stage 5 — Sanity checks

- Gorbova Club: actual ≈ 155, expected ≈ 155. Если `revoke_needed` > 10–15% от actual → STOP, sweep подозрителен, разобрать причину.
- Бухгалтерия как бизнес: actual ≈ 30, только chat/group, channel НЕ учитывать как ошибку.
- Любой revoke-список > 20: явное объяснение (продукт, тариф, дата окончания, почему всё ещё in_chat/in_channel) до любого вывода.

### Stage 6 — F3 контрольный кейс

Отдельный разбор `tkoffise@gmail.com` / @marazevichnatallia по обоим клубам: active platform access yes/no, entitlement/subscription status, actual in_chat/in_channel, верный club_id для revoke и обоснование.

### Stage 7 — Final Telegram verdict

Полные списки по каждому decision: `ok_keep_access`, `revoke_needed`, `reinvite_needed`, `refresh_status_needed`, `manual_review`. Execute не запускается.

### Artifacts

- `.lovable/proofs/telegram_full_access_discovery_2026_05.md`
- `/mnt/documents/telegram_full_access_expected_vs_actual_2026_05.csv`
- `/mnt/documents/telegram_full_access_summary_2026_05.csv`
- `/mnt/documents/telegram_revoke_candidates_verified_2026_05.csv`

### Запрещено

DML; INSERT в `telegram_access_queue`; прямой Telegram API; revoke/grant; изменения `telegram_club_members`, `subscriptions_v2`, `entitlements`, `access_rules`; вызовы `grant-access-for-order`; provider API; изменения secrets/mode.

### DoD трека 1

1. Полная инвентаризация всех Telegram clubs.
2. Подтверждены Gorbova Club и Бухгалтерия как бизнес отдельно.
3. По каждому клубу actual members count.
4. По каждому клубу expected members count.
5. Revoke list объяснён, не строится на старых invite/audit/status.
6. F3 разобрана отдельно.
7. Если revoke_needed большой — дана причина и STOP, execute не предлагается.
8. Execute не запускался.

---

## Трек 2 — Non-Telegram follow-up (read-only, параллельно)

### F1 — Katerina Kaplia (`katrinkap777@rambler.ru`)

- Проверить BUSINESS training/history access: expected (по orders_v2 + tariff bonuses + business_training_history rules) vs actual (entitlements + access_rules + resolver output).
- Сравнить SQL-уровень и UI/resolver уровень (через `useSidebarModules` + `resolveTrainingContentFilter` + `access-resolver.ts`).
- Выдать `gap_class` ∈ {`missing_primary_entitlement`, `missing_business_training_history_access`, `access_end_mismatch`, `tariff_id_mismatch`, `sql_access_exists_but_ui_missing`, `module_entitlements_instead_of_full_access`} и `planned_action`.

### F2 — Елена Гудвилович (`alena.gudvilovich@bk.ru`)

- Проверить: была ли full-tariff покупка или только набор модулей.
- Если full paid order есть, а entitlements выглядят как набор модулей → `confirmed_bug` (`module_entitlements_instead_of_full_access`).
- Если только модули — `by_design`, но всё равно проверить UI visibility модулей через resolver.
- Выдать `gap_class` + `planned_action`.

### Block A/C/D без Telegram

Для всей когорты BUSINESS / ИДЕОЛОГИЯ / Бизнес-леди (из существующего sweep) перечитать и классифицировать строго по non-Telegram gap_class:

- `missing_primary_entitlement`;
- `missing_bonus` / `missing_business_training_history_access`;
- `access_end_mismatch`;
- `tariff_id_mismatch`;
- `module_entitlements_instead_of_full_access`;
- `sql_access_exists_but_ui_missing` (помечать как UI-not-verified, без auto-fix).

Для каждой строки — `planned_action` ∈ {`data_repair_canonical_grant`, `ui_resolver_patch_needed`, `access_rules_patch_needed`, `manual_review`, `no_action`}.

### Artifact трека 2

- `.lovable/proofs/audit_ideology_business_non_telegram_followup_2026_05.md`
- (если нужно) дополнить `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv` колонкой `source_problem` (`data` / `ui_resolver` / `mixed`).

### Запрещено в треке 2

DML; вызов `grant-access-for-order`; правки `entitlements`/`access_rules`/`subscriptions_v2`; UI/resolver patch без отдельного approve; любое касание Telegram.

### DoD трека 2

1. F1 и F2 имеют отдельный разбор SQL vs UI с явным `gap_class` и `planned_action`.
2. Вся cohort переразмечена по non-Telegram gap_class.
3. Указаны 3 категории: чисто data-gap, чисто UI/resolver-gap, mixed.
4. Execute не запускался.

---

## Порядок и зависимости

- Треки 1 и 2 идут параллельно, оба read-only.
- Никакой execute (Telegram revoke/reinvite, grant repairs, UI patches, access_rules patches) до отдельного approve по каждому треку.
- После завершения трека 1 — отдельным сообщением запрос на approve PATCH-TG-DISCOVERY-FULL findings.
- После завершения трека 2 — отдельным сообщением запрос на approve PATCH-UI-RESOLVER-F1-F2 и PATCH-DATA-REPAIR-NON-TG.