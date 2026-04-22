-- Sprint final cleanup: удаляем MINI-PROOF тестовые строки.
-- Before-proof задокументирован в финальном отчёте:
--  - live_event_comments: 1 строка (id=cd7c4e95..., 'MINI-PROOF: avatar must be NULL')
--  - live_event_participant_prefs: 1 строка (display_name='Аноним-MINI-PROOF')

DELETE FROM public.live_event_comments
WHERE content ILIKE '%MINI-PROOF%' OR content ILIKE '%MINIPROOF%';

DELETE FROM public.live_event_questions
WHERE content ILIKE '%MINI-PROOF%' OR content ILIKE '%MINIPROOF%';

DELETE FROM public.live_event_participant_prefs
WHERE display_name ILIKE '%MINI-PROOF%' OR display_name ILIKE '%MINIPROOF%';

-- room_blocks с MINI-PROOF тегом (если есть)
DELETE FROM public.live_event_room_blocks
WHERE (config->>'title') ILIKE '%MINI-PROOF%'
   OR (config->>'body') ILIKE '%MINI-PROOF%'
   OR (config->>'text') ILIKE '%MINI-PROOF%'
   OR (metadata->>'tag') = 'MINI-PROOF';