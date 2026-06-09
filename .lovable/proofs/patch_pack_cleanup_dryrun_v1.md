# PATCH 3 — Cleanup (DRY-RUN ONLY, NO EXECUTE)

Дата: 2026-06-09
Status: **WAITING FOR APPROVE**. Никаких UPDATE/INSERT/DELETE не делалось.

## Кандидаты HIDE (`meta.cleanup_hidden=true`)

### `payments_v2` — 19 строк (по `patch_pack_diagnose_dryrun_v1.md`)
- 8 dev Сергея 10000 BYN (включая `pi_3TeEq1…`)
- 2 `pi_sim_*` симуляции
- 9 sandbox без `user_id`
- 1 QA `pi_3Tfb5Q…`

### `subscriptions_v2` — 15 строк
- 15 `stripe_poland` тестовых `sub_*`, созданных через `cs_test_*`,
  не привязанных к реальным клиентам.

## KEEP (НЕ скрывать)

- `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` — 5 BYN, Сергей, ghost-profile уже
  переключён на реальный auth user (P0). Это валидный платёж.
- 2 client-payments: Юлия Титовец, piletski — реальные клиенты.
- 1 live test-mode subscription `sub_1Tg9B66…` — нужна для PATCH 2 verification.

## REQUIRES MANUAL REVIEW (KEEP_CLIENT)

3 строки из dry-run (`a68d84be…`, `d1859f0b…`, `ec39fc8c…`) —
требуют отдельной классификации перед скрытием.

## Что разрешено (по approve)

- Только подготовить список KEEP / HIDE / DO NOT TOUCH.
- НИЧЕГО не выполнять.

## Что ЗАПРЕЩЕНО до отдельного approve

- ❌ ставить `meta.cleanup_hidden=true`
- ❌ скрывать любые subscriptions
- ❌ скрывать любые payments
- ❌ менять фильтры/списки админки
- ❌ hard DELETE

## Следующий шаг

После завершения PATCH 1/2/4/5 пользователь даёт отдельный approve
с явным списком ID для HIDE. Только тогда создаётся отдельный PATCH
с migration / one-shot script, который пишет `meta.cleanup_hidden=true`.

## DoD

- [x] dry-run список зафиксирован
- [x] KEEP/HIDE/REVIEW классификация описана
- [x] никаких UPDATE/INSERT/DELETE
- [ ] approve пользователя для execute
- [ ] отдельный PATCH с migration после approve
