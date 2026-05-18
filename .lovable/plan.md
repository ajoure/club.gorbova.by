# План подтверждаю, с обязательными правками:

1. F1/F2/F3 считать обязательными regression fixtures.

Если любой из этих кейсов не попал в итоговые CSV/таблицы — dry-run считается failed.

2. Для F1/F2 обязательно дать не только SQL-статус, но и точный источник проблемы:

- data gap;

- access_rules gap;

- product_fulfillment gap;

- resolver/UI gap;

- mixed.

Если UI/impersonation проверить невозможно — статус `ui_not_verified`, но SQL expected/actual всё равно должен быть заполнен.

3. Для F3 Telegram проверить именно фактическое членство:

- `in_chat`;

- `in_channel`;

- `access_status`;

- `last_verified_at`;

- queue invite/revoke history.

Если доступ истёк, но `in_chat=true` или `in_channel=true`, это confirmed bug, а не stale/warning.

4. В итоговом proof обязателен раздел `Recommended execution order`:

- first: Telegram revoke queue;

- second: Telegram reinvite queue;

- third: grant-access-for-order repairs;

- fourth: config/access_rules/product_fulfillment patches;

- fifth: UI/resolver patches.

Execute не запускать.

&nbsp;

PATCH-AUDIT-BUSINESS-IDEOLOGY-FIX-2026-05 (v2, ужесточённый)

F1/F2/F3 со скриншотов — **обязательные контрольные баг-кейсы**, не гипотезы. По ним уже видны признаки 3 разных категорий багов: BUSINESS visibility gap, full→modules degradation, Telegram revoke desync. Dry-run обязан выдать по каждому конкретный `gap_class` + `planned_action`.

## 0. Артефакты предыдущего аудита (DoD-fix)

1. `.lovable/proofs/audit_ideology_business_access_2026_05.md`
2. `/mnt/documents/audit_ideology_business_users.csv`
3. `/mnt/documents/audit_ideology_business_missing_bonus.csv`
4. `/mnt/documents/audit_ideology_business_bonus_full.csv`

## 1. Главная бизнес-логика (SOT для всех проверок)

1. Купил **Gorbova Club / BUSINESS** → должен видеть **весь BUSINESS-набор**: сам клуб + исторические сделки/материалы/тренинги + связанные training modules / historical access по правилам тарифа.
2. Купил **«Бизнес-леди» / полный тариф ЦБ** → должен видеть **полный** набор тарифа, не случайные модули.
3. Telegram-доступ истёк → пользователь **не должен** оставаться в чате/канале. «Приглашение отправлено» само по себе ничего не доказывает.

Telegram-SOT = (active platform access? ∧ TG положен правилом?) × (фактически in_chat/in_channel?) → решение revoke / reinvite / refresh / no-action.

## 2. F1–F3 как обязательные баг-кейсы

### F1. Katerina Kaplia (`katrinkap777@rambler.ru`) — BUSINESS visibility

По 3 продуктам (Gorbova Club/BUSINESS, ЦБ 1ст 2.0/Бизнес-леди, ЗАКРОЙ ГОД/Стандартный):

- paid order + active sub + primary entitlement — есть/нет;
- для BUSINESS дополнительно строится **expected_business_set** (historical deals + training modules из `access_rules` / `tariff_offers` / product_fulfillment) и сверяется с тем, что видит SQL-resolver и UI-resolver (`useSidebarModules` / `access-resolver`);
- если primary есть, а BUSINESS-набор отсутствует — `gap_class = missing_business_training_history_access`, severity high/critical;
- `planned_action` ∈ {`data_repair_canonical_grant`, `access_rules_config_gap`, `product_fulfillment_gap`, `ui_resolver_bug`}.
- Запрещено писать «возможно нормально», пока полный BUSINESS-набор не подтверждён.

### F2. Елена Гудвилович (`alena.gudvilovich@bk.ru`) — full→modules degradation

- Полный perimeter paid orders (product, tariff, status, payment, access window).
- Если есть paid order на full tariff (Бизнес-леди/BUSINESS) → обязан быть primary entitlement на full product + все training/history modules тарифа. Если только module entitlements → `gap_class = module_entitlements_instead_of_full_business_access`, severity high/critical.
- Если реально куплены только модули → `by_design`, **но** обязательно проверить, что эти модули видны в кабинете через `useSidebarModules`.
- Phantom-parent / `module_scope_only`: SQL vs UI расхождение → `gap_class = ui_resolver_module_visibility_bug`.

### F3. Наталья Морозевич (`tkoffise@gmail.com`, `@marazevichnatallia`) — Telegram revoke/desync

По **Gorbova Club** собрать факты: active sub?, active entitlement?, `access_end_at`/`expires_at`, требует ли rule TG, `telegram_club_members` (`in_chat`, `in_channel`, `access_status`, `last_verified_at`), `telegram_access_queue` (pending/processed/revoke).

Решающая матрица:

- platform access истёк + (`in_chat=true` ∨ `in_channel=true` ∨ `access_status='ok'`) → `gap_class = telegram_membership_not_revoked_after_access_expired`, severity high/critical, `planned_action = telegram_revoke_needed_via_canonical_queue`.
- active platform access + TG показывает «истёк» → `gap_class = telegram_status_desync_active_platform_access`, `planned_action = telegram_reinvite_or_status_refresh`.
- «Приглашение отправлено» — НЕ нормальное состояние без проверки: когда отправлено, использовано ли, в чате ли сейчас, не истёк ли invite, не нужен ли уже revoke.

По «Бухгалтерия как бизнес»: если sub истекла и юзера нет в клубе → ok; если в клубе без активного доступа → revoke bug.

## 3. Block A/B/C/D (точечные)

- **A. missing_primary_entitlement (critical):** A1 `alenamalachkevich`/BUSINESS — `grant-access-for-order` (pre-conditions: paid order, tariff match, access_end_at valid). A2 — Елена Гудвилович по результатам F2.
- **B. missing_telegram_access — reinvite (critical):** `2.lady.di.only`, `finassist.by`, `ossiptschik`. Anti-spam pre-check: исключить уже отработавшие в ACCESS-FIX-2, no double-reinvite за 24ч. **Перед B запускать revoke-волну (см. Block E.Telegram)**, чтобы не пере-инвайтить тех, кому положен revoke.
- **C. missing_bonus (high):** 3 кейса из аудита + любые из F1/F2 после `per_product`-фильтра. Только canonical `grant-access-for-order` по родительскому order.
- **D. medium (classify-only):** 4× `access_end_mismatch`, 1× `tariff_id_mismatch`, новое `telegram_status_stale_needs_refresh` (`last_verified_at > 7d` при active sub).

## 4. Block E (новый) — BUSINESS training/history access audit

Цель: найти всех, кто купил Gorbova Club/BUSINESS / Бизнес-леди / ИДЕОЛОГИЯ или иные тарифы, открывающие BUSINESS-набор, но не видят положенные исторические сделки/тренинги/модули.

**Шаги:**

1. Когорта: все active/paid users по перечисленным тарифам (источник — `orders_v2 paid` ∧ `meta.source ≠ rule_engine`, `subscriptions_v2 active`).
2. `expected_access_matrix` на user×product: primary product, historical deals, training modules, bonus/secondary products, TG club/channel (если правилом положен). Источники: `access_rules`, `tariff_offers.meta`, `product_fulfillment`, `training_modules`.
3. `actual_access_matrix`: `entitlements`, `subscriptions_v2`, resolved `access_rules`, output `useSidebarModules`/`access-resolver` (impersonation read-only), фактическая видимость в кабинете.
4. `gap_class`: `missing_business_training_history_access`, `missing_full_tariff_primary_access`, `module_entitlements_instead_of_full_access`, `sql_access_exists_but_ui_missing`, `access_rules_missing_for_business_bundle`, `product_fulfillment_missing`, `no_rules_configured`.
5. **F1 и F2 — обязательные spot-check** этого блока (должны попасть в выгрузку и быть классифицированы явно).

### Block E.Telegram — revoke/reinvite/refresh sweep (исправление G4/G5/G11/G12)

Per-user классификация (по всей базе):

- active access + TG положен + бот привязан + нет membership → `missing_telegram_access`.
- platform access истёк/отсутствует + (`in_chat=true` ∨ `in_channel=true`) → `telegram_membership_not_revoked_after_access_expired`.
- `access_status='ok'` + `last_verified_at` старый → `telegram_status_stale_needs_refresh`.
- `invite_sent` давно + user не вступил → `invite_stale_awaiting_user_or_expired`.
- `invite_sent` + user уже in_chat/in_channel **без** active access → `telegram_invite_marker_misleading_revoke_needed`.

Приоритет действий: **revoke → reinvite → refresh**.

## 5. Запреты (dry-run и будущий execute)

Ручной DML в `entitlements`/`subscriptions_v2`/`access_rules`/`telegram_club_members`; прямой Telegram Bot API; provider API; изменения `access_rules`; secrets/mode changes. Все правки — только canonical write-path (`grant-access-for-order`, `telegram_access_queue` с разрешённым `meta.source`).

## 6. Execute-классификация (вместо общего «reinvite»)

После dry-run каждый кейс получает один из тегов:
`telegram_revoke_needed_via_canonical_queue`, `telegram_reinvite_needed`, `telegram_status_refresh_needed`, `no_action_expired_and_not_in_chat`, `invite_pending_no_action`, `data_repair_canonical_grant`, `access_rules_config_gap`, `product_fulfillment_gap`, `ui_resolver_patch_needed`, `manual_review`.

## 7. Артефакты

- `.lovable/proofs/audit_ideology_business_fix_dryrun_2026_05.md` — block A/B/C/D + F1/F2/F3 per-row.
- `.lovable/proofs/business_training_history_access_sweep_dryrun_2026_05.md` — Block E (BUSINESS visibility) + Block E.Telegram (revoke/reinvite/refresh).
- `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv` — точечный per-row.
- `/mnt/documents/business_training_history_expected_vs_actual_2026_05.csv` — per-user×per-product expected vs actual matrix + gap_class.
- `/mnt/documents/telegram_revoke_reinvite_refresh_sweep_2026_05.csv` — per-user TG decision.

## 8. DoD dry-run (жёсткий)

1. F1/F2/F3 классифицированы как `confirmed_bug` / `false_positive` / `ui_not_verified` / `manual_review` (не «возможно нормально»).
2. Для F1/F2 явно: видит ли BUSINESS training/history access; если нет — причина (нет entitlement / нет access_rule / resolver не возвращает / UI не показывает).
3. Для F3 явно: должен ли быть TG-доступ, есть ли active platform access, реально ли in_chat/in_channel, требуется revoke / reinvite / refresh / no-action.
4. Global sweep отдельно подсчитывает: missing BUSINESS training/history access; TG not revoked after expired; stale invite / stale verification; module entitlements instead of full access.
5. Конкретные списки на выходе: кого через `grant-access-for-order`, кого через TG revoke queue, кого через TG reinvite queue, где нужен resolver/UI patch, где нужен `access_rules`/product_fulfillment config patch.
6. Все 4 артефакта прошлого аудита перечислены с путями.
7. 0 DML, 0 Telegram API, 0 provider API.
8. Execute НЕ запускается; отдельным approve, по блокам (revoke → reinvite → grant), один за раз с verify между блоками.