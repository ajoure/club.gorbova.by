# Lovable plan — status

Обновлено: 2026-05-16 (Europe/Minsk)

## Patches

| Patch | Status | Notes |
|-------|--------|-------|
| H2 LINK-ORDER | **closed** | — |
| H2.1 WEBHOOK-SUBSCRIPTION | **closed** | — |
| H2.1b 3DS finalize (writer + webhook) | **closed + deployed** | proof: `patch_h2_1b_ii_webhook_3ds_replace_2026_05.md` |
| H2.1c legacy one-time path | **analysis_complete** | proof: `patch_h2_1c_legacy_one_time_analysis_2026_05.md` · Go/No-Go = **Recommendation A (retire)** |
| H2.1c-i legacy retirement patch | **closed + deployed** | proof: `patch_h2_1c_i_legacy_retirement_2026_05.md` · bepaid-webhook 54/54 + grant-access 42/42 · DML=0 · migrations=0 · secret=`dry_run` |
| H2.1c-ii legacy bridge + delegate | **N/A** | снято с roadmap (0 paid за 90д, 0 live трафика) — реактивировать только если zone 2 снова получит paid webhook |
| H2b atomic append RPC | **backlog** | — |
| H3 data-repair (Рабчевская и др.) | **pending** | data-repair НЕ выполнять до отдельного approve |
| H4 `BEPAID_REBILL_MATERIALIZATION=mode=on` | **pending** | блокирован до deploy H2.1c-i |
| PATCH G discovery (read-only) | **unchanged** | можно параллельно |

## Safety state

- `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не меняли)
- `mode=on` — не включался
- Production DML = 0 в текущей серии патчей
- Migrations = 0
- Secrets — без изменений
- Рабчевская и другие data-repair — не трогались

## Hard gates

- До deploy **H2.1c-i** (retirement patch) `BEPAID_REBILL_MATERIALIZATION=on` запрещён.
- H2.1c-i fully closed = только после deploy verification (первые часы audit-логов zone 2).
- До отдельного approve — никаких изменений в legacy `public.orders` / `subscriptions(v1)` / `entitlements.product_code`.
- Любой будущий bridge (создание `orders_v2`-двойника) требует отдельного dry-run и approve.

## Proofs (хронология)

- `.lovable/proofs/patch_h2_1b_i_writer_extension_2026_05.md` — writer extension (3DS) closed
- `.lovable/proofs/patch_h2_1b_ii_webhook_3ds_replace_2026_05.md` — webhook 3DS replace closed + deployed
- `.lovable/proofs/patch_h2_1c_legacy_one_time_analysis_2026_05.md` — legacy one-time analysis + Go/No-Go A
- `.lovable/proofs/patch_h2_1c_i_legacy_retirement_2026_05.md` — legacy retirement code+tests closed, deploy pending
