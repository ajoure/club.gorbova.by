Да, согласен, с учетом правок:

1. План в целом правильный: Stage 5 должен закрыть две практические проблемы:

- UI-кнопка “Применить с сокращением сроков” должна явно показывать результат;

- no_source_window должен решаться через fallback по tariff.access_days / product.default_access_days, если это возможно.

&nbsp;

2. В backend-fallback нужно не использовать “target_product.default_access_days от текущего момента” как первый безопасный вариант.

Если нет source window, правильнее считать от:

- sub.access_start_at;

- sub.created_at;

- order.paid_at / [order.deal](http://order.deal)_date, если доступен source order;

- только если ничего нет — manual_review_no_anchor_date.

&nbsp;

Нельзя молча строить срок “от now()”, потому что это может искусственно продлить доступ.

&nbsp;

3. Добавить отдельный guard:

если fallback даёт plannedExpiry меньше текущей даты, не создавать/не продлевать доступ автоматически, а классифицировать как:

expired_source_window

или condition_not_met.

&nbsp;

4. no_source_window не надо полностью убирать из stop_reasons глобально.

Правильнее:

- для preview это категория диагностики;

- для targeted execute она не должна блокировать другие выбранные категории;

- но если selected_action_ids включает no_source_window — execute запрещён.

&nbsp;

5. Execute reducible_by_rule по 22 строкам разрешён в этом патче, но только если:

- allow_reduce_access=true;

- apply_categories=['reducible_by_rule'] или selected_action_ids ровно этих 22;

- preflight повторно подтвердил count=22;

- нет manual/admin/human-lineage без allow_manual_override;

- нет paid/subscription window, который покрывает текущий более длинный срок.

&nbsp;

6. После execute обязательно проверить не только reducible=0, но и:

- конкретные 22 строки получили expires_at = plannedExpiry;

- previous_expires_at сохранён в meta;

- reduction_reason / batch_id записаны;

- audit_logs содержит batch summary;

- access_grant_ledger, если используется, содержит изменения.

&nbsp;

7. UI-тесты добавить обязательно:

- backend error → toast.error;

- stop_reasons → toast.error;

- idempotent skip → понятный toast;

- execute reducible → фильтр switched to changed/reducible;

- auto-refresh показывает reducible=0.

&nbsp;

8. Никакие revoke/soft-expire/manual override в Stage 5 не запускать.

Только reduce по 22 строкам и fallback для no_source_window.

Итоговая команда:

План Stage 5 принимаю с правками.

&nbsp;

Разрешаю в рамках PATCH-RETROAPPLY-STAGE-5:

&nbsp;

1. Backend:

- добавить window fallback;

- anchor date брать только из sub.access_start_at / sub.created_at / source order paid_at/deal_date;

- не использовать now() как silent fallback для product.default_access_days;

- если anchor date не найден → no_source_window/manual_review_no_anchor_date;

- если plannedExpiry уже в прошлом → expired_source_window / condition_not_met, без auto-create;

- audit meta.window_resolved_from и window_anchor_source.

&nbsp;

2. Frontend:

- исправить execute UX для reducible;

- toast.error при error/stop_reasons;

- idempotent skip toast;

- auto-switch фильтра после execute;

- показывать window_resolved_from.

&nbsp;

3. Execute:

- разрешён только apply_categories=['reducible_by_rule'] по ожидаемым 22 строкам;

- allow_reduce_access=true;

- revoke/soft-expire/manual override запрещены.

&nbsp;

4. Verify:

- reducible_by_rule=0 после execute;

- no_source_window снизился с 7 до 0 или объяснён остаток;

- 22 строки реально сокращены до plannedExpiry;

- previous_expires_at и batch_id сохранены;

- audit summary есть;

- regression user 3328ff3b чистый.

&nbsp;

5. Запрещено:

- soft_expire/revoke;

- Telegram;

- physical DELETE;

- changes orders_v2/subscriptions_v2/access_rules;

- manual/admin override.

&nbsp;

Proof:

.lovable/proofs/retroapply_stage_5_window_fallback_and_execute_ux_2026_[05.md](http://05.md)

CSV:

/mnt/documents/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.csv

&nbsp;

План: PATCH-RETROAPPLY-STAGE-5 — fix execute + window fallback by product

## 1. Diagnose

По репорту и коду подтверждено два независимых дефекта:

**D1. «Применить с сокращением сроков (22)» визуально не отрабатывает.**

- В `RetroApplyPanel.handleExecuteWithReductions` (line 478) сейчас:
  - НЕТ `preflightOk()` (в отличие от `handleExecuteSelected`);
  - НЕТ toast'а об ошибке, если бек вернул `error`/`stop_reasons` (в `runRetroApply` для не-execute путей и для путей с `stop_reasons` идёт «silent inline»);
  - НЕТ принудительного открытия фильтра «changed/reducible» после execute, поэтому пользователь сидит на фильтре `no_source_window` и не видит, что 22 reducible-строки уехали в «already_satisfied».
- В `runRetroApply` ветка `mode === "execute"` не различает «ничего не сделано» (created=0, updated=0, skipped>0): тост `Фактически изменено: создано 0, обновлено 0` визуально читается как «ничего не работает».
- Бек: `executeActions` для `reducible_by_rule` корректно требует `allow_reduce_access` + `hasCategories` ИЛИ `selected_action_ids`. Передаётся из UI правильно. Проблема — на UI-стороне (отсутствие фидбэка + не переключённый фильтр).

**D2. Категория `no_source_window` (7 строк) блокирует «канонизацию» даже в `admin_canonicalize_all`.**

- В `supabase/functions/rules-retroapply/index.ts` (line 506) запись попадает в `no_source_window`, если:
  - `rule.duration_days` пуст И
  - `sub.access_end_at` пуст.
- Категория жёстко в `NEVER_EXECUTE_CATEGORIES` (line 901) — ни selection, ни admin-mode её не разблокируют.
- Однако у любого `source_tariff` есть `access_days` (или у самого target-продукта — `default_access_days`), из которых window определяется однозначно. Сейчас этот fallback не используется.

## 2. Fix

### 2.1 Backend — `supabase/functions/rules-retroapply/index.ts`

1. Расширить расчёт `plannedExpiry` (line ~491) трёхуровневой цепочкой:
  - `rule.duration_days` (как сейчас),
  - `sub.access_end_at` (как сейчас),
  - **новый fallback**: `tariff.access_days` от `source_tariff` подписки (через `tariffMap`, который уже грузится), отсчитываемый от `sub.access_start_at || sub.created_at`. Если и этого нет — `target_product.default_access_days` от текущего момента.
2. Если все три источника дали `null` → оставить `no_source_window` (как сейчас).
3. Если fallback сработал — пометить action флагом `meta.window_resolved_from = "tariff_access_days" | "product_default_access_days"` и НЕ ставить категорию `no_source_window`; запись пойдёт по обычной ветке `missing_access` / `reducible_by_rule` / `aligned_update_needed`.
4. STOP-guard (line 234): убрать `no_source_window:` из stop_reasons, потому что теперь это валидная категория «нельзя определить даже с fallback» — фильтр в UI остаётся, но execute не блокируется при targeted-вызове (он и так не блокировался для targeted, но stop-reason добавлял путаницу).
5. `NEVER_EXECUTE_CATEGORIES`: `no_source_window` остаётся в нём (после fallback таких записей будет 0 для нормальных тарифов; те, что остались, действительно неразрешимы).
6. Audit: в `audit_logs.meta` для stage 5 писать `window_fallback_applied: N` (количество записей, для которых сработал fallback).

### 2.2 Frontend — `src/components/admin/product/RetroApplyPanel.tsx`

1. **handleExecuteWithReductions:**
  - Добавить `preflightOk()` (как в `handleExecuteSelected`).
  - После `runRetroApply("execute", …)` переключать `activeFilter` на `"changed"` (или `"reducible_by_rule"`), чтобы пользователь увидел результат.
2. **runRetroApply (execute branch):**
  - Если `res.error` или `res.stop_reasons?.length` — показывать `toast.error` (а не только inline), чтобы пользователь явно понимал, что выполнение не прошло.
  - Если `executed.created === 0 && executed.updated === 0 && executed.skipped > 0` — тост `Все записи уже соответствуют правилам (idempotent skip)`.
3. **Подсказка под категорией `no_source_window`:** перерисовать строку диагностики — «срок определён по тарифу/продукту» с пометкой `window_resolved_from`, если бек его проставил.
4. Категория `no_source_window` остаётся read-only (как и раньше); пользователь не должен исполнять её напрямую — но после fallback таких строк станет 0 в большинстве случаев.

## 3. Dry-run

Cohort B / Gorbova Club BUSINESS + Подоходный налог + Деньги BY (правила, давшие 7 строк `no_source_window` на скриншоте):

1. `nightly_safe` + `mode=preview` — ожидаем `no_source_window=0..1` (вместо 7) после fallback; reducible_by_rule остаётся 22.
2. `admin_canonicalize_all` + `mode=preview` — то же + replace_system_or_manual_lineage.
3. Regression user `3328ff3b…` — total=0 сохранён.
4. Execute `apply_categories=["reducible_by_rule"]` + `allow_reduce_access=true` на cohort B — ожидаем updated=22, skipped=0; авто-refresh preview показывает reducible=0.

Никакого destructive execute по `revoke_extra_access` / `soft_expire_extra_access` / `replace_system_or_manual_lineage` в этом патче не запускать.

## 4. DoD

- Кнопка «Применить с сокращением сроков (22)» в Cohort B выдаёт видимый тост + автоматически переключает фильтр + after auto-refresh показывает reducible=0.
- Категория `no_source_window` на Cohort B падает до 0 (или ≤1, если у подписки нет ни tariff_id, ни access_end_at, ни access_start_at).
- В admin-режиме админ может довести базу до канонического состояния без необходимости вручную править данные.
- Stop-guard не возвращает `no_source_window:N` при targeted execute.
- Никаких destructive UPDATE/DELETE по orders_v2/subscriptions_v2/access_rules.
- Регрессия `3328ff3b…` чистая.
- Proof: `.lovable/proofs/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.md` + CSV в `/mnt/documents/`.

## 5. Артефакты

- `supabase/functions/rules-retroapply/index.ts`
- `src/components/admin/product/RetroApplyPanel.tsx`
- `.lovable/proofs/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.md`
- `/mnt/documents/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.csv`