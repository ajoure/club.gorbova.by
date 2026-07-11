# Known unresolved risks — Sprint B (по состоянию на 2026-07-10)

Единый реестр открытых рисков. Обновляется при каждой доставке. Пока хотя бы один пункт в статусе OPEN — Sprint B не может быть закрыт как PASS.

Формат: `ID — тема — статус — краткое обоснование — blocker для`.

## R1 — Provider contract РР не подтверждён

- Статус: **OPEN**.
- Обоснование: нет живых запросов к тестовому endpoint РР, нет подтверждённого поведения `createOrder` (идемпотентность, retry-семантика), `getOrderStatus` (definitive `not_found` vs transient), формата ошибок. Документ `gate_a1/rr_provider_contract.md` не заполнен.
- Blocker для: Gate A.2, полной корректности classifier (safe-default сейчас корректен, но подтверждение контракта может расширить множество definitive-исходов).

## R2 — Preview / test Supabase environment отсутствует

- Статус: **OPEN (внешний инфраструктурный блокер на стороне Lovable)**.
- Обоснование: инфраструктура Lovable Cloud не предоставляет отдельного preview/test Supabase-проекта, изолированного от production, куда можно было бы применить миграцию v3.1a, задеплоить edge с fault-injection, поднять mock RR и выполнить SQL/edge suites. Требования — см. `preview_environment_setup.md`.
- Blocker для: Gate A.1 v3.1a runtime, Gate A.2 runtime, Gate B runtime.

## R3 — Runtime suite Gate A.1 v3.1a не запускался

- Статус: **OPEN**.
- Обоснование: без preview environment (R2) выполнены только draft-артефакты. Ни 18 SQL-сценариев, ни 16 edge-сценариев, ни fault injection, ни mock RR ledger не запускались.
- Blocker для: Gate A.1 v3.1a acceptance.

## R4 — Reconciler `rr-reconcile-order` не реализован

- Статус: **OPEN**.
- Обоснование: Gate A.2 не начат. Edge функции `rr-reconcile-order` (verify_jwt=true, service-role/cron only) в кодовой базе нет. Backoff / attempts policy, terminal-guard, alert на `operator_required` — не реализованы.
- Blocker для: Gate A.2 acceptance, реального выхода ambiguous-состояний из `rr_reconciliation_pending`.

## R5 — UI wiring `PaymentDialog → public-rr-installment-initiate` не проверен

- Статус: **OPEN**.
- Обоснование: discovery подтвердил только цепочку HTML → CustomEvent → `SitePageBySlug` → `pickOfferForFlow` → `PaymentDialog` (см. `event_chain_proof.md`). Что именно `PaymentDialog` вызывает для `offer_type === "bank_installment"` и как обрабатывает `already_*` / `rr_call_in_flight` / `local_state_unconfirmed` — не проверено.
- Blocker для: Gate B UI regression и public E2E.

## R6 — Gate B (patch / deploy / public E2E) не выполнен

- Статус: **OPEN**.
- Обоснование: по правилам плана Gate B открывается только после Gate A.1 v3.1a runtime PASS и Gate A.2 PASS.
- Blocker для: Sprint B acceptance.

## R7 — `amount = 0` для двух bank_installment офферов (`gl_buh`, `biz-l`)

- Статус: **OPEN**.
- Обоснование: `tariff_offers.amount = 0.00` для двух из трёх целевых офферов. Источник итоговой суммы для payload РР не документирован. См. `ui_wiring_discovery.artifacts/amount_zero_investigation.md`.
- Blocker для: Gate B RUNTIME PASS (но не для discovery).

## R8 — Разночтение отображаемых цен (Tilda `1490/1690` vs DB)

- Статус: **OPEN (низкий приоритет, вне scope Sprint B)**.
- Обоснование: цены в Tilda-HTML не совпадают ни с одним `tariff_offers.amount` продукта. Задача копирайта / контента.
- Blocker для: ничто из Sprint B.

## R9 — Fault-injection hook в production bundle

- Статус: **OPEN (не проверено runtime)**.
- Обоснование: дизайн hook'а описан в `fault_injection_architecture.md` и предусматривает отсутствие в production bundle. Runtime-подтверждение (`fault_injection_absent_in_production.txt`) невозможно без deploy'а, следовательно ещё не собрано.
- Blocker для: разрешения активировать fault-injection в preview.

## R10 — Backfill legacy markers в `meta.rr` не валидирован на реальных данных

- Статус: **OPEN**.
- Обоснование: миграция содержит controlled backfill. Реальный набор строк, попадающих под условие, известен только в production. Проверить безопасность и рассчитать `rows_updated` можно только в preview с копией нужных фикстур либо в отдельной сессии production `SELECT` (read-only), которая пока не выполнялась.
- Blocker для: применения миграции.

## Правило снятия

Пункт переводится в `RESOLVED` только с явной ссылкой на runtime-доказательство (файл в `runtime_proof/` или заполненный документ). Заявление «сделано» без артефакта — недопустимо.
