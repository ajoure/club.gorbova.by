# D-slice-3 — Autoweb Scenario Editor CRUD (report v1.0)

## Scope
Admin-only Scenario Editor: create / update / delete / bulk-shift / preview / apply / cancel
для сценарного контента ведущего. Полностью изолирован от `live_event_comments`
и `live_event_questions`.

## Files changed
- `supabase/migrations/20260720100440_*.sql` — таблицы, RLS, RPC.
- `src/components/admin/live/AutowebScenarioEditor.tsx` — новый UI.
- `src/pages/admin/AdminLiveEvents.tsx` — монтирование в таб «Сценарий».

## DB objects (new)
- `public.autoweb_scenario_entries` (state: draft/applied/archived, offset_seconds 0..86400).
- `public.autoweb_scenario_audit` (append-only, write only через SECURITY DEFINER RPC).
- Триггер `trg_autoweb_scenario_entries_touch` (updated_at).
- Guard `public._autoweb_scenario_require_admin()` — единственная точка проверки роли.
- RPC (все SECURITY DEFINER, admin/super_admin only, ревокнуты для PUBLIC):
  - `autoweb_scenario_list(_live_event_id, _include_applied)`
  - `autoweb_scenario_upsert(_live_event_id, _entries jsonb)`
  - `autoweb_scenario_delete(_live_event_id, _entry_ids uuid[])`
  - `autoweb_scenario_bulk_shift(_live_event_id, _delta_seconds int)`
  - `autoweb_scenario_preview(_live_event_id)`
  - `autoweb_scenario_apply(_live_event_id)`
  - `autoweb_scenario_cancel(_live_event_id)`

## Isolation guarantees
- Ни один код не читает/пишет `live_event_comments` или `live_event_questions`
  в рамках этого слайса — проверено grep. Runtime overlay
  `AutowebTimelineOverlay` уже render-only, писателей нет.
- RLS: `autoweb_scenario_entries` — доступ только admin/super_admin;
  `autoweb_scenario_audit` — SELECT admin/super_admin; INSERT только через RPC.

## Proof (runtime)
- Migration deploy: OK (см. tool result 20260720-100440).
- Функции присутствуют с prosecdef=true и корректными сигнатурами (SQL below).
- Preflight на реальном автовебинаре `d25f3ea5-af4c-4c47-9d51-02a282611d2d`:
  entries=0, audits=0 — writer ничего не создал случайно.
- Anonymous execution гарантированно блокируется в `_autoweb_scenario_require_admin`
  через `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'`.
- Typecheck: без новых ошибок.

## Not touched
CRM / companies / payments / integrations / live_stream / legacy recorded_webinar.

## Next
Runtime overlay writer, который будет читать applied entries и рендерить их
в комнате согласно player time, — отдельная задача (D-slice-4 или Phase E).
