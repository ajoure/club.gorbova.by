-- Cleanup test fixture used for Sprint B proof-pack
DELETE FROM public.live_event_comments
WHERE live_event_id IN (SELECT id FROM public.live_events WHERE slug = '__test_autoweb_b__');

DELETE FROM public.live_event_questions
WHERE live_event_id IN (SELECT id FROM public.live_events WHERE slug = '__test_autoweb_b__');

DELETE FROM public.live_event_sessions
WHERE live_event_id IN (SELECT id FROM public.live_events WHERE slug = '__test_autoweb_b__');

DELETE FROM public.live_events WHERE slug = '__test_autoweb_b__';