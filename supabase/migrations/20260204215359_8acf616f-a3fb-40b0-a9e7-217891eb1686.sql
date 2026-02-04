-- Add role_description to lesson_blocks constraint
ALTER TABLE lesson_blocks 
  DROP CONSTRAINT IF EXISTS lesson_blocks_block_type_check;

ALTER TABLE lesson_blocks 
  ADD CONSTRAINT lesson_blocks_block_type_check 
  CHECK (block_type IN (
    'heading', 'text', 'accordion', 'tabs', 'spoiler', 'callout', 'quote',
    'video', 'audio', 'image', 'gallery', 'file',
    'button', 'embed', 'divider', 'timeline', 'steps',
    'quiz_single', 'quiz_multiple', 'quiz_true_false', 'quiz_fill_blank',
    'quiz_matching', 'quiz_sequence', 'quiz_hotspot', 'quiz_survey',
    'input_short', 'input_long', 'checklist', 'table_input', 'file_upload', 'rating',
    'container', 'columns', 'condition',
    'video_unskippable', 'diagnostic_table', 'sequential_form',
    'role_description'
  ));