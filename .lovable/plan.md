Да, согласен, с учетом правок:

1. Цель патча уточнить:

&nbsp;

Нужно чинить не разовый кейс и не просто окно RetroApplyPanel, а единый канонический механизм reconcile-доступов:

&nbsp;

- ручная кнопка в UI / MOCK / retroapply;

- ночная функция access-rules-nightly-reconcile;

- grant-access-for-order после оплаты.

&nbsp;

Все три должны использовать один общий engine:

supabase/functions/_shared/product-access-grants.ts

&nbsp;

2. Убрать формулировку “ночная функция по умолчанию без удаления/сокращения”.

&nbsp;

Ночная функция должна уметь:

- находить недоданные доступы;

- реактивировать системные expired-доступы;

- продлевать;

- сокращать;

- soft-expire лишние системные доступы;

- не трогать manual/admin.

&nbsp;

Но опасные действия должны быть под флагами:

allowReduceAccess

allowRevokeOrExpireAccess

allowTelegramActions

&nbsp;

3. UI-кнопка должна быть не просто preview, а полноценный безопасный repair-инструмент:

&nbsp;

В UI:

- preview;

- execute;

- batch_id;

- summary;

- список ошибок;

- повторная проверка после execute;

- кнопка “исправить безопасные”;

- отдельно destructive checkbox для сокращения/снятия лишних системных доступов.

&nbsp;

4. Ошибка source_rule_id_conflict должна исчезнуть как технический blocker.

&nbsp;

Правильная логика:

если expired entitlement системного происхождения и новый rule даёт тот же target_product_id, то:

- reactivate / relink / replace;

- не падать технической ошибкой;

- manual/admin lineage не трогать.

&nbsp;

5. Club/Telegram не silent skip.

&nbsp;

Если club rule найден:

- в preview показывать отдельную категорию `telegram_action_required`;

- в execute product-access не делать прямой Telegram API;

- Telegram grant/revoke только через canonical queue отдельным controlled step.

&nbsp;

6. Ночная сверка должна писать полный audit:

&nbsp;

- сколько найдено;

- сколько создано;

- сколько продлено;

- сколько реактивировано;

- сколько сокращено;

- сколько soft-expired;

- сколько manual_review;

- batch_id;

- error list.

&nbsp;

7. Добавить обязательный regression по пользователю:

&nbsp;

`3328ff3b-10ad-4295-aac9-51ef0419767e`

&nbsp;

Ожидаемый результат:

- 3 старые ошибки `source_rule_id_conflict` больше не technical error;

- каждая строка классифицируется как:

  - reactivate_system_lineage;

  - replace_system_lineage;

  - manual_review_manual_lineage.

&nbsp;

8. Добавить финальный DoD:

&nbsp;

После execute:

- повторный preview показывает 0 safe actions;

- остаются только manual_review / telegram_action_required;

- ночная функция на той же когорте не создаёт новых расхождений;

- grant-access-for-order и retroapply дают одинаковый результат по одному и тому же набору rules.

&nbsp;

9. Не делать “разовый фикс данных” вместо исправления механизма.

&nbsp;

Задача — исправить саму функцию выдачи/перевыдачи/сверки доступов, чтобы дальше через UI и nightly можно было приводить всё в порядок автоматически.

&nbsp;

10. Execute после исправления кода разрешён только по safe actions:

&nbsp;

- add;

- extend;

- reactivate system lineage;

- relink/replace system lineage.

&nbsp;

Сокращение и снятие лишних доступов — только отдельным checkbox/flag и только для system-generated entitlements.

Коротко: план правильный по направлению, но его нужно ужесточить: **чинить не один RetroApplyPanel, а общий reconcile-engine**, чтобы UI-кнопка и nightly job реально сами приводили доступы в порядок.

&nbsp;

План:

1. **Проблема**
  - В окне «Применение правил к историческим данным» сейчас появляются «неразрешимые записи» и ошибки `source_rule_id_conflict`.
  - Текущая кнопка ретро-применения работает не как единый канонический движок: часть логики дублирует `_shared/product-access-grants.ts`, а не использует его напрямую.
  - Из-за этого историческое применение расходится с `grant-access-for-order` и ночной сверкой: конфликтные expired-доступы не реактивируются, `club`-правила вообще пропускаются, сокращение сроков есть только частично, а удаление лишних доступов отсутствует.
2. **Диагностика**
  - Найден существующий canonical helper: `supabase/functions/_shared/product-access-grants.ts`.
  - Его уже используют:
    - `grant-access-for-order` — каноническая выдача после оплаты;
    - `access-rules-nightly-reconcile` — ночная сверка;
    - заявлено, что должен использовать `rules-retroapply`, но фактически `rules-retroapply` содержит собственную классификацию и собственный execute path.
  - По audit видно последние запуски `rules_retroapply.executed`: `targeted=3`, `skipped_error=3`, `reactivation_candidates_found=3` — это совпадает со скриншотом.
  - По конкретному пользователю со скриншота `3328ff3b-10ad-4295-aac9-51ef0419767e` три expired entitlement имеют `source_rule_id`, который отличается от текущего активного правила. Поэтому старая логика пытается реактивировать expired entitlement и останавливается на `source_rule_id_conflict`.
  - Также найдено: `rules-retroapply` логирует `Club rule ... skipped in retroapply v1 — club grants require telegram integration`, то есть club/Telegram-доступы в этом инструменте сейчас не применяются.
  - RLS/права не являются корневой причиной: edge functions работают через service role, проблема в бизнес-логике reconcile.
3. **Предлагаемое решение**
  - Перевести `rules-retroapply` с собственной устаревшей логики на общий helper `_shared/product-access-grants.ts`, чтобы ручное применение правил, ночная сверка и выдача после оплаты считали доступы одинаково.
  - В helper добавить управляемый reconciliation-режим:
    - `dryRun=true` — только предпросмотр;
    - `allowReduceAccess=true` — разрешить уменьшать `expires_at` до канонического срока;
    - новый флаг `allowRevokeOrExpireAccess=true` — разрешить убирать/истекать лишние rule-generated доступы, если активное правило больше не даёт права.
  - Ошибку `source_rule_id_conflict` исправить не «силовым переписыванием», а правильной классификацией:
    - если entitlement expired и новый rule должен выдать тот же `target_product_id`, можно безопасно реактивировать/перепривязать только если lineage системный (`rule_engine`, `retroapply`, `source_rule_id`, `BACKFILL/RETROAPPLY`) и нет manual/admin признаков;
    - manual/admin доступы не трогать автоматически.
  - Для лишних доступов использовать не физическое удаление, а безопасное изменение статуса/срока:
    - rule-generated active entitlement, для которого больше нет права по текущим правилам, переводить в expired/revoked-совместимый статус или ставить `expires_at=now()` согласно существующему статусному контракту после проверки фактических используемых статусов;
    - писать причину в `meta` и `access_grant_ledger`/`audit_logs`.
  - UI «Применение правил к историческим данным» расширить под полный reconcile:
    - показать категории: добавить, продлить, сократить, реактивировать, истечь/убрать лишний, конфликт/manual review, уже корректно;
    - добавить явную опцию «Разрешить сокращение и снятие лишних системных доступов»;
    - оставить STOP-guards и предпросмотр обязательными перед execute.
4. **Изменяемые компоненты**
  - Edge functions:
    - `supabase/functions/rules-retroapply/index.ts` — заменить устаревшую локальную классификацию на общий reconcile engine;
    - `supabase/functions/_shared/product-access-grants.ts` — добавить режимы reduce/revoke и корректную обработку expired system lineage с другим `source_rule_id`;
    - возможно `supabase/functions/access-rules-nightly-reconcile/index.ts` — только если нужно передать новые флаги в dry-run/execute, по умолчанию без удаления/сокращения.
  - UI:
    - `src/components/admin/product/RetroApplyPanel.tsx` — новые категории, тексты, подтверждение опасного режима.
  - Документация/proof:
    - `.lovable/plan.md`;
    - новый proof-файл с dry-run, execute и verify.
  - База:
    - на первом этапе новых таблиц не создавать;
    - миграция понадобится только если фактическая схема/индексы/ограничения не позволяют безопасно логировать revoke/expire в существующий `access_grant_ledger`.
5. **Что не будет изменено**
  - Не менять `orders_v2` как источник транзакций.
  - Не менять `subscriptions_v2` как источник recurring-доступов.
  - Не менять правила `access_rules` без отдельного подтверждения.
  - Не делать физический массовый `DELETE` entitlement-строк.
  - Не трогать ручные/admin доступы автоматически.
  - Не создавать второй механизм выдачи доступов.
6. **Dry-run**
  - Запустить `rules-retroapply` в preview/dry-run по текущему продукту/кохорте.
  - Проверить отдельно проблемного пользователя `3328ff3b-10ad-4295-aac9-51ef0419767e`:
    - три текущие ошибки должны перейти из `source_rule_id_conflict` в безопасную категорию `reactivate/replace/system_lineage` или в понятный manual-review, если lineage окажется ручным.
  - Получить сводку по категориям:
    - сколько будет добавлено;
    - сколько продлено;
    - сколько сокращено;
    - сколько будет истечено/убрано как лишнее;
    - сколько manual conflict.
  - STOP, если:
    - есть manual/admin доступы в автоматическом изменении;
    - количество revoke/expire неожиданно большое;
    - есть target_product_id без активного правила, но с действующей оплаченной подпиской;
    - итоговая выборка отличается от preview после повторного dry-run.
7. **Execute**
  - Сначала исправить код и задеплоить изменённые backend functions.
  - Выполнить безопасный preview.
  - Execute делать только после подтверждённого preview:
    - сначала добавить/продлить/реактивировать;
    - затем отдельным режимом разрешить сокращение/истечение лишних системных доступов.
  - Все действия писать в audit/ledger с batch_id.
8. **STOP-guards**
  - Не выполнять автоматическое снятие доступа, если entitlement имеет `source_type='manual'`, `source_type='admin'`, `granted_by` содержит `manual/admin`, или есть `manual_access_edit_*` без явного allow.
  - Не трогать entitlement, если есть несколько active entitlements на один `(user_id, product_id)` — manual review.
  - Не снижать сроки без отдельного флага `allow_reduce_access`.
  - Не истекать доступ без отдельного флага `allow_revoke_or_expire_access`.
  - Не менять подписки/заказы при reconcile вторичных доступов.
  - Не выполнять batch, если dry-run содержит неожиданные product/tariff/rule UUID вне выбранного scope.
9. **DoD**
  - Ошибки `source_rule_id_conflict` в текущем сценарии больше не появляются как технические ошибки execute.
  - Предпросмотр показывает все типы изменений: создать, продлить, сократить, реактивировать, истечь лишний, конфликт.
  - Execute может как увеличивать, так и уменьшать сроки при явном разрешении.
  - Лишние системные доступы снимаются безопасно, ручные не трогаются.
  - `rules-retroapply`, `access-rules-nightly-reconcile` и `grant-access-for-order` используют один источник логики для product_access.
  - Повторный preview после execute показывает 0 неожиданных изменений, кроме manual-review.
  - В `audit_logs` и/или `access_grant_ledger` есть сводная запись batch.
10. **Риски и зависимости**
  - Автоматическое снятие доступов — high-risk операция; поэтому будет реализовано через dry-run + отдельный destructive-флаг + soft-expire/revoke, не через физический delete.
  - `club`/Telegram-доступы требуют отдельной осторожной интеграции с `telegram-grant-access`/`telegram-revoke-access`; в рамках первого исправления можно отразить их в preview и не делать silent skip, но массовый Telegram revoke лучше выполнять отдельным подтверждаемым этапом.
  - Ночные job сейчас по умолчанию не сокращают и не снимают доступы; включать это автоматически без отдельного подтверждения не буду.
11. **Требуется дополнительная информация**
  - Перед execute я проверю фактические статусы `entitlements.status`, чтобы выбрать безопасный способ «удаления» лишнего доступа: `expired` или существующий revoked/canceled-эквивалент.
  - Если нужно, чтобы Telegram-клубы тоже автоматически удаляли людей из чатов, это лучше вынести во второй PATCH после proof по product_access.