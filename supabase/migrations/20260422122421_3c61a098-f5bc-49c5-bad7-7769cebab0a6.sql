-- PATCH B1a: расширить допустимые block_type до набора, который реально поддерживает runtime.
-- Add-only: старые значения (button/banner/form) остаются валидными.

ALTER TABLE public.live_event_room_blocks
  DROP CONSTRAINT IF EXISTS live_event_room_blocks_block_type_check;

ALTER TABLE public.live_event_room_blocks
  ADD CONSTRAINT live_event_room_blocks_block_type_check
  CHECK (block_type IN ('button','banner','form','text','product_choice'));