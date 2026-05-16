## Статус: H3.x-b-execute-B / Stage 1 — closed (2026-05-16)

Stage 1 (read-only dry-run) выполнен. Proof: `.lovable/proofs/h3x_duplicate_subscriptions_execute_b_dryrun_2026_05.md`.
Stage 2 НЕ запущен — ожидает отдельный approve. Backup-таблицы исключены, поле `meta.source_subscription_v2_id` зафиксировано.

---

да, согласен, с учетом правок:

1. **В Stage 2 убрать backup-таблицу или вынести в отдельную migration-approval.**  
Сейчас Stage 1 можно approve, но в будущем Stage 2 снова содержит:

```text
subscriptions_v2_repair_backup_h3x_b_b_2026_05
```

Это migration/schema change. Для consistency с execute-A лучше:

```text
backup — через before-snapshot в proof + audit before/after JSON
без создания backup-таблиц
```

2. **В Stage 2 использовать фактическое поле** `meta.source_subscription_v2_id`**.**  
В плане снова указано:

```text
meta.source_subscription_id
```

Заменить на фактическое поле:

```text
meta.source_subscription_v2_id
```

3. **Сейчас approve только на Stage 1 dry-run.**  
Execute Stage 2 не запускать.

Команда:

```text
Выполни только Stage 1 — read-only dry-run по H3.x-b-execute-B.

Запрещено:
- UPDATE/INSERT/DELETE;
- provider API;
- Telegram calls;
- grant-access-for-order;
- migrations;
- backup-таблицы;
- изменение secrets;
- mode=on.

В proof дай:
- полную таблицу P5/P7;
- STOP-guards;
- before-snapshot;
- expected Stage 2 plan без backup-таблиц;
- rollback SQL из before-snapshot;
- verdict по каждой паре.

Stage 2 execute не запускать без отдельного approve.
```

После этих правок план можно запускать как **read-only dry-run**.

&nbsp;

План: H3.x-b-execute-B — provider-managed duplicate subscriptions cleanup (Stage 1: read-only dry-run)

Scope: только 2 пары Cluster B. Никаких других. Никаких других пользователей / продуктов / тарифов.

```
P5: 56f8a606 (canonical) ↔ 98bc1c69 (duplicate) — user bb724225, product 11c9f1b8 (Gorbova Club), tariff 7c748940 (BUSINESS)
P7: eba308ca (canonical) ↔ c30f04c3 (duplicate) — user 6b0e0451, product 11c9f1b8 (Gorbova Club), tariff 7c748940 (BUSINESS)
```

## Что уже подтверждено из read-only-probe

1. provider_subscriptions (SOT для provider-связи) показывает:
  - canonical 56f8a606 → sbs_f874f468f78734df, state=active, next_charge=2026-06-05
  - duplicate 98bc1c69 → sbs_673a1877356f9556, state=canceled (admin_cancel 2026-04-08)
  - canonical eba308ca → sbs_b5c5ea6a57413c72, state=active, next_charge=2026-05-08 (stale, требует refresh, НО refresh — вне scope этого плана)
  - duplicate c30f04c3 → sbs_0c978ba5afbef001, state=canceled (admin_cancel 2026-04-10)
2. У обоих duplicates нет active/pending provider_subscriptions → provider cancel НЕ требуется (canonical safety preserved).
3. У обоих canonicals есть active provider_subscriptions с собственным provider_subscription_id → trogать их запрещено.
4. subscriptions_v2.meta.bepaid_subscription_id у duplicates указывает на canonical provider_id (ISSUE-WEBHOOK-META-OVERWRITE follow-up) — это meta-загрязнение, не реальная связь. Чистка meta-полей duplicate допустима только локально.

## Stage 1 (этот approve) — что делает dry-run

Только read-only. Никакого DML. Никаких edge-вызовов. Никаких provider API.

Для каждой из 2 пар собирает и сохраняет в proof таблицу с колонками:

```
pair, user_id, product_id, tariff_id,
canonical_id, duplicate_id,
canonical.status, duplicate.status,
canonical.auto_renew, duplicate.auto_renew,
canonical.access_end_at (before), duplicate.access_end_at (before),
canonical.next_charge_at, duplicate.next_charge_at,
canonical.meta.bepaid_subscription_id, duplicate.meta.bepaid_subscription_id,
canonical.provider_subs (id+state), duplicate.provider_subs (id+state),
canonical.meta.extended_by_orders, duplicate.meta.extended_by_orders,
entitlement_id, entitlement.expires_at (before),
new_canonical.access_end_at = GREATEST(canonical, duplicate),
new_entitlement.expires_at  = GREATEST(current, new_canonical.access_end_at),
greatest_changes_canonical (bool),
greatest_changes_entitlement (bool),
risk_flags[],
verdict ∈ {ready_for_execute, manual_review}
```

И отдельные read-only проверки:

1. orders_v2: показать все orders по обоим subs (через meta.subscription_v2_id или extended_by_orders), без правок.
2. payments_v2: показать payments по этим orders, без правок.
3. installment_payments: убедиться, что нет pending по обоим.
4. access_rules: убедиться, что нет правил, ссылающихся на duplicate_id.
5. provider_subscriptions: показать обе стороны, подтвердить duplicate.state IN ('canceled','expired') и canonical.state='active'.
6. telegram_access_queue / telegram_channel_members: read-only показать актуальные записи (только для логирования, не трогаем).
7. audit_logs: последние 20 записей по обоим subs (контекст).
8. global re-probe: COUNT(*) активных duplicate-пар = 2 (только P5/P7).

## STOP-guards (если хоть один — verdict=manual_review, execute не предлагается)

- duplicate.provider_subscriptions есть в state ∈ ('active','pending')
- canonical.provider_subscriptions отсутствует или state ≠ 'active'
- new_canonical.access_end_at < canonical.access_end_at (before)
- new_entitlement.expires_at  < entitlement.expires_at (before)
- найдены installment_payments.status='pending' на duplicate
- найдены access_rules, ссылающиеся на duplicate_id
- найдены orders_v2 в статусе pending/processing на duplicate
- global active duplicate count ≠ 2
- duplicate.user_id ≠ canonical.user_id, или product_id/tariff_id различаются
- canonical.id или duplicate.id не из whitelisted 4 UUID

## Что Stage 1 НЕ делает

- Никаких UPDATE / INSERT / DELETE в production.
- Никаких provider API вызовов (никакого bepaid-cancel-subscriptions, никакого bepaid-get-subscription-details, никаких pull/sync).
- Никаких Telegram вызовов (никакого telegram-grant-access, telegram-revoke-access, очередей).
- Никаких grant/revoke (grant-access-for-order не дергаем).
- Никаких изменений orders_v2 / payments_v2 / provider_subscriptions / entitlements / access_rules.
- Никаких migrations.
- BEPAID_REBILL_MATERIALIZATION не трогаем (остаётся dry_run).
- mode=on НЕ включаем.
- Не чиним stale provider_subscriptions.next_charge_at у canonical eba308ca (это отдельный backlog item, см. ниже).
- Не чиним meta.bepaid_subscription_id pollution у duplicates (войдёт в Stage 2 как часть superseded-меты, но только локально, без provider влияния).

## Stage 2 (отдельный approve, после принятия Stage 1)

Структурно идентичен H3.x-b-execute-A:

1. Backup в `subscriptions_v2_repair_backup_h3x_b_b_2026_05` (RLS deny authenticated, service_role only) — 4 строки.
2. Per-pair транзакция (2 транзакции суммарно):
  - duplicate: status='superseded', auto_renew=false, meta.superseded_by=canonical_id, meta.superseded_reason='h3x_b_provider_managed_duplicate_no_active_provider', meta.repair_batch='H3X-B-EXECUTE-B-2026-05', meta.original_bepaid_subscription_id (сохраняем для аудита, не удаляем).
  - canonical: access_end_at=GREATEST(canonical, duplicate), meta.extended_by_orders = dedup union, meta.merged_from = append duplicate_id, meta.repair_batch='H3X-B-EXECUTE-B-2026-05'. provider-поля canonical НЕ трогаем.
3. entitlements: только если new_entitlement.expires_at > current — UPDATE expires_at и meta.source_subscription_id=canonical_id. Если уже больше — пропускаем (ожидание: оба уже >= canonical, апдейтов 0).
4. audit_logs: 4 записи (по 2 на пару) с actor_type='system', repair_batch.
5. Rowcount guards: каждая UPDATE должна вернуть ровно 1 строку, иначе ROLLBACK.
6. Post-verify: те же 10 точек что в Cluster A + сверка provider_subscriptions canonical state осталась 'active' и duplicate state осталась 'canceled' (никто не двигал).

Stage 2 НЕ включает:

- provider cancel (duplicate уже canceled на стороне bePaid).
- Telegram операции.
- orders_v2 / payments_v2 / provider_subscriptions / access_rules изменения.
- migrations.
- mode=on enable.

## DoD Stage 1

- Proof файл: `.lovable/proofs/h3x_duplicate_subscriptions_execute_b_dryrun_2026_05.md` с полной таблицей, before-snapshots, верификацией каждого STOP-guard, явным verdict на каждую пару.
- Production DML = 0.
- Migrations = 0.
- Provider API calls = 0.
- Telegram calls = 0.
- grant-access-for-order calls = 0.
- BEPAID_REBILL_MATERIALIZATION = dry_run (не менялся).
- mode=on disabled.
- Global active duplicate pairs пересчитан = 2.
- Cluster A пары (P1–P4, P6) не упомянуты в DML и не затронуты.

## Backlog (не часть этого плана, фиксируется отдельно)

- ISSUE-WEBHOOK-META-OVERWRITE: webhook применяет meta-апдейт по слишком широкому match (user+product), из-за чего meta.bepaid_subscription_id и access_end_at у одной подписки могут перетекать на параллельную. Эта же проблема создала Cluster B duplicates. Фикс — match строго по provider_subscriptions.subscription_v2_id + provider_subscription_id.
- ISSUE-PS-STALE-NEXT-CHARGE: provider_subscriptions для canonical eba308ca имеет next_charge_at=2026-05-08 (просрочено), хотя subscriptions_v2 показывает 2026-06-07. Нужен таргетированный pull через bepaid-get-subscription-details (отдельный read-only approve).
- ISSUE-AG-DOUBLECLICK: остаётся из A.

## Текущий статус

```
H3.x-b-execute-A     — closed
H3.x-b-execute-B/S1  — этот план (read-only dry-run)
H3.x-b-execute-B/S2  — отдельный approve после S1
Active duplicate pairs — 2
H4 mode=on            — still blocked
```