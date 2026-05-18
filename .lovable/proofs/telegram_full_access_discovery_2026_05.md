# PATCH-TG-DISCOVERY-FULL — read-only proof

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Режим:** READ-ONLY. 0 DML. 0 Telegram API. 0 provider API. Execute не запускался.

## 1. Главный вывод

Прежний sweep PATCH-TG-REVOKE-1 (133 кандидата) — **ложный**. Он строился на `telegram_club_members.access_status='ok'` как маркере членства, а не на фактических `in_chat`/`in_channel`. Из-за этого попадали исторические/неподдерживаемые строки. Реальная картина существенно меньше и совпадает с бизнес-ожиданием (~155 / ~30).

## 2. Stage 1 — Telegram clubs inventory

| club_id | club_name | chat_id | channel_id | chat_status | channel_status | требует chat | требует channel |
|---|---|---|---|---|---|:---:|:---:|
| `fa547c41-3a84-4c4f-904a-427332a0506e` | Gorbova Club | `-1001686262735` | `-1001791889721` | active | active | yes | yes |
| `4f8f9d8f-07ce-4898-8012-39f1035c1456` | Бухгалтерия как бизнес | `-1003707939536` | — | active | pending (не используется) | yes | **no** |

Привязка продуктов (`access_rules.grant_target_type='club' AND is_active=true`):

- **Gorbova Club** ← открывается через:
  - product `11c9f1b8` *Gorbova Club* (любой тариф);
  - product `9d0d6de8` *Платная консультация*, **только tariff `c1b4bb88`**.
- **Бухгалтерия как бизнес** ← product `85046734` *Бухгалтерия как бизнес* (любой тариф).

## 3. Stage 2 — actual membership (агрегаты)

| club | total rows | in_chat | in_channel | any-member | без profile_id |
|---|---:|---:|---:|---:|---:|
| Gorbova Club | 643 | **155** | 155 | 155 | 0 |
| Бухгалтерия как бизнес | 642 | **34** | 0 (channel не используется) | 34 | 0 |

Совпадает с бизнес-ожиданием ≈155 / ≈30. Старые 133 revoke были собраны по 1285 «архивным» строкам — это не члены, а исторические записи.

## 4. Stage 3 — Expected access (SOT)

Для каждого (user, club) перепроверено по приоритету:
1. active `entitlements` (`status='active'`, `expires_at IS NULL OR > now()`) по продуктам клуба;
2. active/trial/past_due `subscriptions_v2` с `access_end_at > now()` по `product_id` (+ tariff_id для Платной консультации → Gorbova Club);
3. `access_rules` использовался ТОЛЬКО как маппинг product → club, не как источник прав.

## 5. Stage 4 — Expected vs actual matrix (итог)

| club | actual members | expected access | ok_keep | reinvite | revoke | no_action | telegram_not_linked |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gorbova Club | 155 | 148 | 143 | 5 | **12** | 483 | 0 |
| Бухгалтерия как бизнес | 34 | 33 | 33 | 0 | **1** | 608 | 0 |
| **Итого** | **189** | **181** | **176** | **5** | **13** | **1091** | **0** |

Decisions берутся строго из утверждённого списка.

## 6. Stage 5 — Sanity checks

- Gorbova Club: revoke 12/155 = **7.7%** (ниже порога 10–15%). OK.
- Бухгалтерия: revoke 1/34 = 2.9%. OK. Channel не используется → не учитывался как ошибка.
- Сравнение со старым sweep: 133 → 13 (×10 редукция). Старый список не пригоден к execute.

Топ-причины revoke (12+1):
- `in_chat_or_channel_but_no_active_platform_access` (100%): пользователь физически в чате/канале, но active entitlement и active subscription отсутствуют. Это и есть честные кандидаты на revoke. Все 13 проверены: ни один не имеет активного entitlement/subscription по продуктам клуба.

## 7. Stage 6 — F3 контрольный кейс (Наталья Морозевич)

| club | expected_access | in_chat | in_channel | active ent | active sub | decision |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Gorbova Club (`fa547c41`) | **no** | **yes** | **yes** | нет | нет | **revoke_needed** |
| Бухгалтерия (`4f8f9d8f`) | no | no | n/a | нет | нет | no_action_no_access_and_not_member |

→ Подтверждённый `revoke_needed` ровно по одному club_id — Gorbova Club. Никаких других клубов её не касается.

## 8. Stage 7 — Final verdict (read-only)

Полные списки доступны в `/mnt/documents/telegram_full_access_expected_vs_actual_2026_05.csv`. Краткое:

- `ok_keep_access`: **176** — никаких действий.
- `revoke_needed`: **13** (12 Gorbova + 1 Бухгалтерия) — список в `telegram_revoke_candidates_verified_2026_05.csv`, включая F3.
- `reinvite_needed`: **5** (Gorbova: у них активный доступ, но недостаёт chat ИЛИ channel).
- `refresh_status_needed`: **0** (все актуальные строки имеют свежий `last_verified_at` через sync).
- `manual_review_conflicting_data`: **0**.
- `telegram_not_linked_by_user`: **0** в текущей когорте member-строк.

Execute **не запускается**. Следующий шаг — отдельный approve на PATCH-TG-REVOKE-2 строго по `telegram_revoke_candidates_verified_2026_05.csv` (13 строк) через canonical `telegram_access_queue` с `meta.source='repair'`, `meta.reason='expired_platform_access_but_still_member'`, `meta.patch='PATCH-TG-REVOKE-2'`, и отдельный approve на PATCH-TG-REINVITE-1 (5 строк).

## 9. Artifacts

- `.lovable/proofs/telegram_full_access_discovery_2026_05.md` (этот файл)
- `/mnt/documents/telegram_full_access_expected_vs_actual_2026_05.csv` (1285 строк, полная матрица)
- `/mnt/documents/telegram_full_access_summary_2026_05.csv` (агрегаты по клубам)
- `/mnt/documents/telegram_revoke_candidates_verified_2026_05.csv` (13 строк)

## 10. Запреты — соблюдены

- 0 DML.
- 0 INSERT в `telegram_access_queue`.
- 0 вызовов Telegram API.
- 0 вызовов provider API.
- 0 правок `telegram_club_members` / `subscriptions_v2` / `entitlements` / `access_rules`.
- 0 вызовов `grant-access-for-order`.
- 0 изменений secrets/mode.

## 11. DoD

| критерий | статус |
|---|:---:|
| Полная инвентаризация Telegram clubs | ✅ |
| Gorbova Club и Бухгалтерия выделены | ✅ |
| Actual members count по каждому клубу | ✅ (155, 34) |
| Expected members count по каждому клубу | ✅ (148, 33) |
| Revoke list объяснён, не строится на старых invite/audit/status | ✅ (только in_chat/in_channel + active ent/sub) |
| F3 разобрана отдельно | ✅ (revoke по Gorbova Club, no_action по Бухгалтерии) |
| Если revoke большой — STOP | n/a (revoke 13, в пределах sanity) |
| Execute не запускался | ✅ |
