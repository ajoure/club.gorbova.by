да, согласен, с учетом правок:

1. В Diagnose явно проверь, **какая мутация сейчас реально стоит за** `useTriggerHealthCheck()` и **какая мутация уже есть/отсутствует для full-check**. Не предполагай, что надо “заменить на full-check”, пока не увидишь текущий hook/endpoint и query keys.
2. В Dry-run добавь явную проверку, **какой именно report берёт** `useLatestFullCheck()`:
  &nbsp;
  &nbsp;
  - по `created_at desc`
  - по `kind/type`
  - нет ли фильтра, из-за которого он берёт не тот отчёт.  
  Иначе можно заменить кнопку, а UI всё равно останется на старом селекторе.
3. В Execute зафиксируй разделение контуров жёстко:
  - **owner-view**: только `system_health_reports` / full-check;
  - **Техинфо**: только `system_health_runs` / nightly.  
  Никаких общих derived-status между ними.
4. Для `onRefresh` не просто `refetch`, а **точечная invalidation query keys**:
  - latest full-check
  - reports list для diff
  - и отдельно nightly/runs только для вкладки Техинфо.  
  Это нужно явно перечислить по именам после Diagnose.
5. В DoD добавь ещё один пункт:
  - после нажатия `Запустить проверку` новый report должен быть **новее предыдущего по** `created_at`, и diff должен считаться уже от него, а не от старого cached-объекта.
6. STOP-guard дополни:
  - если full-check endpoint не существует как отдельный клиентский hook/mutation, сначала оформить **минимальный фронтовый hook** к уже существующей backend-функции, без изменения backend. Это допустимо и всё ещё UI-only.
7. В Verify зафиксируй 2 сценария:
  - `Запустить проверку` → создаётся новый full-check report, owner-view зеленеет;
  - `Обновить` без запуска → просто подтягивает уже существующий свежий full-check report и тоже убирает false-red без hard reload.
8. Ничего не меняй в humanize/mapping/карточках owner-view, если Diagnose не покажет, что проблема только в источнике и refresh-flow. Это должен быть чистый fix согласованности данных, без побочных UI-правок.

&nbsp;

После этих уточнений план можно выполнять.

&nbsp;

План:

## Проблема

На /admin/system-health всё ещё показываются красные INV-P0-1 и INV-P0-4, хотя узкий backend PATCH уже применён и последний `system-health-full-check` в базе зелёный.

## Диагностика

Фактическое состояние подтверждено read-only:

- `supabase/functions/system-health-full-check/index.ts` уже содержит новую логику:
  - `INV-P0-1` → `audit_logs.action='bepaid.payment.upsert_from_last_transaction'`
  - `INV-P0-4` → RPC `get_cron_runs_24h_count()`
- В `system_health_reports` уже есть свежий успешный отчёт:
  - `2026-04-24 18:37:13+00`
  - `INV-P0-1 = 7, passed=true`
  - `INV-P0-4 = 4906, passed=true`
  - общий `status = OK`
- Но owner-view страницы `/admin/system-health` строится из `useLatestFullCheck()` / `system_health_reports`, а её кнопки сейчас работают не с тем источником:
  - `Запустить проверку` вызывает `nightly-system-health` через `useTriggerHealthCheck()`
  - `Обновить` делает только `refetchLatest()` для `system_health_runs`
- Из-за этого UI «Проблемы сейчас» может продолжать показывать старый full-check report, даже когда backend уже зелёный.

## Предлагаемое решение

Сделать узкую фронтовую правку согласованности источника истины для owner-view:

1. На `/admin/system-health` привязать верхнюю кнопку `Запустить проверку` к `system-health-full-check`, а не к nightly-check.
2. Кнопку `Обновить` сделать рефрешем owner-view-источников:
  - `system_health_reports`
  - `latestFullCheck`
  - при необходимости diff-источника последних отчётов
3. Не менять саму backend-логику инвариантов, cron, bePaid, audit writer’ы и thresholds.

## Изменяемые компоненты

Только узкий фронтовый scope:

- `src/pages/admin/AdminSystemHealth.tsx`
- при необходимости минимально:
  - `src/hooks/useSystemHealthFullCheck.ts`
  - `src/hooks/useSystemHealthRuns.ts` (только если понадобится явный refetch API для техвкладки)

## Что не будет изменено

- `supabase/functions/system-health-full-check/index.ts`
- RPC `public.get_cron_runs_24h_count()`
- `nightly-system-health`
- cron/jobs
- webhook bePaid
- audit writer’ы
- thresholds / окна
- UI-классификация инвариантов и тексты карточек

## Dry-run

Перед выполнением проверить:

1. какие query keys использует owner-view;
2. какие именно запросы инвалидируются после ручного запуска full-check;
3. что верхние карточки действительно рендерятся только из `latestFullCheck.report_json.invariants.results`.

## Execute

1. В `AdminSystemHealth.tsx` заменить owner action `onRunCheck` на вызов full-check мутации.
2. В `AdminSystemHealth.tsx` заменить `onRefresh` на refetch/invalidations для `system-health-latest-full` и `system-health-reports`.
3. Сохранить `useLatestSystemHealth()` / `useSystemHealthRuns()` только для вкладки «Техинфо».
4. Не трогать остальную страницу.

## STOP-guards

Остановиться, если выяснится хотя бы одно:

- owner-view использует ещё один скрытый источник данных помимо `system_health_reports`;
- есть другой компонент, который перезаписывает статус из `system_health_runs` поверх owner-view;
- кнопка `Запустить проверку` намеренно должна запускать nightly-flow по бизнес-требованию и это зафиксировано в коде/knowledge.

## DoD

Задача считается выполненной, когда одновременно выполнено всё:

1. После ручного запуска проверки в owner-view создаётся новый `system_health_reports` full-check report.
2. Верхний hero и вкладка «Проблемы сейчас» переходят в зелёное состояние без ручного hard reload.
3. Старый false-red исчезает.
4. Значения берутся из новых источников истины, а не из старого отчёта:
  - `INV-P0-1 = 7` из bePaid audit signal
  - `INV-P0-4 = 4906` из pg_cron RPC
5. Вкладка «Техинфо» продолжает отдельно показывать nightly `system_health_runs` без поломки.

## Риски и зависимости

- Есть два разных health-контура: `system_health_reports` и `system_health_runs`. Главный риск — снова смешать их в одном экране.
- Изменение должно быть строго UI-only; backend уже исправлен.

## Требуется дополнительная информация

Не требуется. Read-only диагностика достаточна для перехода в Execute.