ALTER TABLE public.live_event_room_blocks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_room_blocks;