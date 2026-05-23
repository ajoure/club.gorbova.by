Да, правильно. Нужно не дробить на 50 approve. Формат: **один патч → dry-run → execute safe/destructive по выбранным флагам → автотесты → скрины/доказательства → итоговый отчёт**.

Отправь ему так:

Стоп. Не дробим Stage 4 на бесконечные отдельные approve.

&nbsp;

Нужно сделать один полноценный патч:

&nbsp;

PATCH-RETROAPPLY-STAGE-4 — full canonical reconcile engine + tested UI flow

&nbsp;

Формат работы:

1. Code patch.

2. Tests.

3. Dry-run/preview.

4. Execute в безопасных режимах.

5. Execute destructive только если включены explicit admin-флаги в UI.

6. Verify.

7. Proof со скринами/логами/CSV.

&nbsp;

Не останавливаться после каждого микрошагa, если:

- действие покрыто планом;

- есть dry-run;

- есть guards;

- есть rollback/stop;

- scope в рамках PATCH-RETROAPPLY-STAGE-4.

&nbsp;

Что нужно сделать:

&nbsp;

1. Реализовать общий `_shared/reconcile-engine.ts`.

2. Перевести `rules-retroapply` и `access-rules-nightly-reconcile` на этот engine.

3. В UI RetroApplyPanel сделать полноценный режим:

   - nightly_safe preview;

   - admin_canonicalize_all preview;

   - add/extend/reactivate/relink;

   - reduce;

   - soft-expire/revoke лишних;

   - manual/admin override;

   - telegram_action_required preview.

4. В UI должны быть явные чекбоксы:

   - разрешить сокращение сроков;

   - разрешить снятие лишних доступов;

   - разрешить перезапись manual/admin;

   - подтверждаю применение по текущим правилам.

5. Execute должен работать из UI по batch_id/selected_action_ids.

6. Nightly по умолчанию safe:

   - не сокращает;

   - не revoke;

   - manual/admin не трогает;

   - только add/extend/reactivate/relink safe.

7. Admin UI mode может менять любые доступы, включая manual/admin, если super_admin включил флаги.

&nbsp;

Обязательные тесты:

- Deno/unit tests по engine;

- nightly_safe vs admin_canonicalize_all;

- manual/admin lineage;

- reduce disabled/enabled;

- revoke disabled/enabled;

- paid source window не удаляется;

- telegram_action_required не вызывает Telegram;

- regression user `3328ff3b…`;

- UI smoke: preview → execute → repeat preview = 0 safe actions.

&nbsp;

Нужны доказательства:

- скрины UI preview;

- скрины destructive summary;

- скрины execute result;

- CSV action log;

- audit_logs batch summary;

- proof по режимам симуляции.

&nbsp;

Разрешаю в рамках одного патча:

- выполнить dry-run;

- выполнить safe execute;

- выполнить admin destructive execute только по явно выбранным тестовым/подтверждённым строкам через UI-флаги;

- затем сделать verify.

&nbsp;

Запрещено:

- физический DELETE entitlements;

- прямой Telegram API;

- Telegram queue insert в этом патче;

- менять orders_v2;

- менять subscriptions_v2;

- менять access_rules;

- provider API.

&nbsp;

Главное:

не спрашивать approve после каждого подшага.

Остановиться только если:

- тесты падают;

- dry-run показывает неожиданный массовый revoke/reduce;

- затрагиваются orders/subscriptions/access_rules;

- есть риск удаления paid active access;

- UI execute расходится с preview.

&nbsp;

Финальный артефакт:

.lovable/proofs/retroapply_stage_4_full_canonical_reconcile_execute_2026_[05.md](http://05.md)

&nbsp;

CSV:

./mnt/documents/retroapply_stage_4_full_canonical_reconcile_execute_2026_05.csv

&nbsp;

В финальном отчёте показать:

- что сделано;

- какие тесты прошли;

- какие скрины приложены;

- сколько доступов добавлено/продлено/реактивировано/сокращено/истекло;

- какие строки остались manual_review;

- что nightly и UI используют один engine;

- что повторный preview после execute показывает корректное состояние.

Смысл: **один нормальный рабочий патч**, а не серия согласований. Dry-run нужен, но он должен быть частью одного цикла: проверил → применил → доказал.

&nbsp;

План: PATCH-RETROAPPLY-STAGE-4 — full canonical reconcile completion

## 0. Контекст

Stage 1–3 закрыли точечные баги, dual-mode engine и super_admin guard. Stage 4 добавляет недостающую половину канонизации — **детектор лишних доступов**, переключает `access-rules-nightly-reconcile` на тот же engine, что и UI RetroApply, и доводит UI до полной destructive-готовности (без автоматического запуска destructive в этом патче).

Никакого destructive execute в Stage 4 — только код + dry-run + proof. Destructive прогон будет отдельным approve после ревью proof.

## 1. Бэкенд `rules-retroapply/index.ts` — extra-access detector

Добавить новый этап анализа «по пользователю», параллельный текущему «по правилу».

Алгоритм для каждой пары (user_id, product_id) с активным entitlement:

1. Собрать все активные `access_rules`, чьё `target_product_id = product_id` и которые могли бы покрывать пользователя (через условия купленных тарифов).
2. Для каждого rule вызвать существующий `evalUserAgainstRule` (prior-purchase, source window и т. д.).
3. Если **ни одно** правило не даёт права И нет независимого paid/subscription window, покрывающего текущий entitlement.expires_at → entitlement классифицируется как лишний.

Новые категории действий:

- `already_correct` — entitlement подтверждён хотя бы одним rule/source window;
- `soft_expire_extra_access` — система выдала, но право утрачено: установить `expires_at = now()` + `meta.expired_by_canonicalize`;
- `revoke_extra_access` — system-lineage и явно «зомби» (нет любого источника, expires_at в будущем без обоснования): `status=revoked` + `meta.revoked_by_canonicalize`;
- `manual_review_ambiguous_source` — есть paid/subscription, но окно меньше текущего expires_at (потенциальный reduce, классифицируется как `reducible_by_rule` оставляем — здесь только если источник вообще неразборчив);
- `manual_review_paid_access_exists` — paid window покрывает доступ, rule не покрывает → не трогать, пометить.

Lineage rules:

- nightly_safe: extra-access manual/admin/unknown → `conflict_existing` (как было) + `manual_review_*`;
- admin_canonicalize_all + `allow_manual_override=true` + `allow_revoke_or_expire_access=true` → разрешён soft_expire/revoke для manual/admin;
- system-lineage + `allow_revoke_or_expire_access=true` → soft_expire/revoke в обоих режимах при явном selection/category.

Запреты в коде:

- physical `DELETE FROM entitlements` запрещён;
- Telegram API/queue insert — запрещены;
- `orders_v2`/`subscriptions_v2`/`access_rules` — read-only.

## 2. `access-rules-nightly-reconcile/index.ts` — переключение на единый engine

Превратить функцию в thin wrapper над `rules-retroapply`:

- внутренний вызов engine с фиксированной конфигурацией:
  - `reconcile_mode = 'nightly_safe'`,
  - `allow_reduce_access = false`,
  - `allow_revoke_or_expire_access = false`,
  - `allow_manual_override = false`,
  - `apply_categories = ['missing_access', 'relink_source_rule']` (extend/reactivate уже внутри missing/relink),
  - destructive категории → preview-only, попадают в audit summary, но не исполняются;
- audit summary пишется в `audit_logs` с разбивкой по всем категориям (включая `soft_expire_extra_access`, `revoke_extra_access`, `telegram_action_required` — как наблюдаемые, но не применённые);
- classification обязана 1-в-1 совпадать с UI preview на той же когорте.

Чтобы избежать дублирования кода — выделить core engine из `rules-retroapply` в `_shared/reconcile-engine.ts` (минимально: экспорт preview+execute с явной конфигурацией), и оба caller'а (UI edge и nightly) импортируют его.

## 3. UI `RetroApplyPanel.tsx`

Добавить:

- блок «Лишние доступы» в category-chips: `soft_expire_extra_access`, `revoke_extra_access`, `manual_review_ambiguous_source`, `manual_review_paid_access_exists`;
- отдельный **Destructive summary** под основной сводкой: счётчики reduce / soft-expire / revoke + предупреждающий badge;
- чекбокс «Разрешить снятие лишних доступов» → `allow_revoke_or_expire_access` (доступен только в admin_canonicalize_all);
- чекбокс «Разрешить сокращение сроков» (уже есть `allow_reduce_access` — оставить);
- чекбокс «Разрешить перезапись ручных/admin доступов» (уже есть `allow_manual_override`);
- кнопка execute активна только если выбран конкретный `batch_id` (preview run) ИЛИ конкретные `selected_action_ids`;
- **preflight re-preview** (уже реализован в Stage 3) — расширить на новые категории; если изменилась destructive-сводка → STOP с явным toast;
- никаких изменений в Telegram-execute path.

## 4. Telegram

- `telegram_action_required` уже preview-only — оставить как есть;
- никаких queue-insert и Telegram API вызовов в Stage 4;
- UI продолжает показывать категорию явным chip-ом с пояснением «обрабатывается отдельным потоком».

## 5. Tests (Deno)

Добавить `supabase/functions/rules-retroapply/extra_access_test.ts` с фикстурами:

1. system entitlement без покрытия rule + без paid → admin mode `soft_expire_extra_access`; nightly → `manual_review`/preview-only;
2. manual lineage без права → nightly: `conflict_existing`/`manual_review`; admin+`allow_manual_override`+`allow_revoke_or_expire_access`: `soft_expire`/`revoke`;
3. paid order покрывает window → ни в каком режиме не soft-expire (`manual_review_paid_access_exists`);
4. `allow_revoke_or_expire_access=false` → execute по destructive категории = no-op;
5. `allow_reduce_access=false` → reduce не выполняется;
6. nightly wrapper vs UI preview на одной фикстуре → identical category counts;
7. club rule → `telegram_action_required`, нет insert в `telegram_access_queue`.

## 6. Dry-run (read-only после code patch)

Прогнать engine на трёх срезах:

- Cohort B (Gorbova Club BUSINESS, `tariff_id=7c748940-...`) — `nightly_safe` и `admin_canonicalize_all`;
- regression user `3328ff3b-10ad-4295-aac9-51ef0419767e` — обе модели, ожидаем `total=0`;
- когорта с известными manual markers (CB20 + `cohort_repair`) — доказать различие nightly vs admin.

Зафиксировать totals по всем категориям, выделить destructive-кандидатов отдельным списком.

## 7. Артефакты

- `.lovable/proofs/retroapply_stage_4_full_canonical_reconcile_dryrun_2026_05.md` — отчёт со всеми срезами, lineage-разбивка, регрессии;
- `/mnt/documents/retroapply_stage_4_full_canonical_reconcile_dryrun_2026_05.csv` — полный action log dry-run.

## 8. Запреты (жёстко)

- physical DELETE entitlements;
- Telegram API / `telegram_access_queue` insert;
- любые изменения `orders_v2` / `subscriptions_v2` / `access_rules`;
- destructive execute в Stage 4 — **запрещён**, только preview;
- автоматическое снятие manual/admin в nightly — запрещено.

## 9. DoD

- extra-access detector реализован и покрыт unit-тестами;
- `access-rules-nightly-reconcile` использует общий engine из `_shared/reconcile-engine.ts`;
- UI и nightly дают идентичную классификацию на одной фикстуре (тест #6);
- admin_canonicalize_all способен soft-expire/revoke лишние доступы при явных трёх флагах + super_admin;
- nightly остаётся safe (нулевые destructive executes);
- `telegram_action_required` виден в UI, без execute;
- все новые Deno tests зелёные;
- dry-run на трёх когортах покрывает категории add/extend/reactivate/relink/reduce/soft-expire/revoke/manual-review/telegram;
- destructive execute не запускался;
- proof + CSV созданы.

## 10. Технические детали реализации

Файлы:

- **new** `supabase/functions/_shared/reconcile-engine.ts` — общий core (preview + execute с DI: supabase client, конфиг, actor);
- **edit** `supabase/functions/rules-retroapply/index.ts` — HTTP-обёртка + super_admin guard + extra-access этап через core;
- **edit** `supabase/functions/access-rules-nightly-reconcile/index.ts` — переключение на core с nightly-safe конфигом + audit summary;
- **new** `supabase/functions/rules-retroapply/extra_access_test.ts` — Deno tests;
- **edit** `src/components/admin/product/RetroApplyPanel.tsx` — новые категории, destructive summary, preflight-расширение.

После approve этого плана: код-патч → deploy edge functions (`rules-retroapply`, `access-rules-nightly-reconcile`) → tests → dry-run → proof. Только после ревью proof обсуждать отдельный destructive approve.