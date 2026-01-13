-- Drop old constraint and add new one with quiz types
ALTER TABLE lesson_blocks DROP CONSTRAINT lesson_blocks_block_type_check;

ALTER TABLE lesson_blocks ADD CONSTRAINT lesson_blocks_block_type_check 
CHECK (block_type = ANY (ARRAY[
  -- Base types
  'heading'::text, 'text'::text, 'video'::text, 'audio'::text, 'image'::text, 
  'file'::text, 'button'::text, 'embed'::text, 'divider'::text,
  -- Quiz types
  'quiz_single'::text, 'quiz_multiple'::text, 'quiz_true_false'::text,
  'quiz_fill_blank'::text, 'quiz_matching'::text, 'quiz_sequence'::text, 'quiz_hotspot'::text,
  -- Additional content types
  'quote'::text, 'callout'::text, 'spoiler'::text, 'tabs'::text, 'accordion'::text, 
  'steps'::text, 'timeline'::text, 'gallery'::text
]));