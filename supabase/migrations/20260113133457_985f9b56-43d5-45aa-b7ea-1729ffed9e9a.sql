-- Module
INSERT INTO training_modules (id, product_id, title, slug, is_active, sort_order)
VALUES (
  'aaaaaaaa-0001-0001-0001-000000000001',
  '11c9f1b8-0355-4753-bd74-40b42aa53616',
  'Test Module for Quiz Proof',
  'test-module-quiz-proof',
  true,
  1
);

-- Lesson (content_type = 'mixed' for block-based lessons)
INSERT INTO training_lessons (id, module_id, title, slug, content_type, is_active, sort_order)
VALUES (
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000001',
  'Test Lesson – Quiz Runtime Proof',
  'test-lesson-quiz-runtime-proof',
  'mixed',
  true,
  1
);

-- Block 1: quiz_fill_blank (2 blanks with inputType)
INSERT INTO lesson_blocks (id, lesson_id, block_type, content, sort_order)
VALUES (
  'cccccccc-0001-0001-0001-000000000001',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'quiz_fill_blank',
  '{
    "textBefore": "Заполните пропуски:",
    "blanks": [
      {"id": "blank-1", "correctAnswer": "Привет", "inputType": "text", "acceptedVariants": [], "dropdownOptions": []},
      {"id": "blank-2", "correctAnswer": "Мир", "inputType": "text", "acceptedVariants": [], "dropdownOptions": []}
    ],
    "textAfter": "!",
    "points": 2,
    "caseSensitive": false
  }'::jsonb,
  1
);

-- Block 2: quiz_matching (2 pairs WITH rightId)
INSERT INTO lesson_blocks (id, lesson_id, block_type, content, sort_order)
VALUES (
  'cccccccc-0001-0001-0001-000000000002',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'quiz_matching',
  '{
    "question": "Сопоставьте элементы:",
    "pairs": [
      {"id": "pair-1", "rightId": "right-1", "left": "A", "right": "1"},
      {"id": "pair-2", "rightId": "right-2", "left": "B", "right": "2"}
    ],
    "points": 2
  }'::jsonb,
  2
);

-- Block 3: quiz_sequence (correctOrder 0..N-1)
INSERT INTO lesson_blocks (id, lesson_id, block_type, content, sort_order)
VALUES (
  'cccccccc-0001-0001-0001-000000000003',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'quiz_sequence',
  '{
    "question": "Расположите в правильном порядке:",
    "items": [
      {"id": "item-1", "text": "Первый", "correctOrder": 0},
      {"id": "item-2", "text": "Второй", "correctOrder": 1},
      {"id": "item-3", "text": "Третий", "correctOrder": 2}
    ],
    "points": 3
  }'::jsonb,
  3
);

-- Block 4: quiz_hotspot (1 area)
INSERT INTO lesson_blocks (id, lesson_id, block_type, content, sort_order)
VALUES (
  'cccccccc-0001-0001-0001-000000000004',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'quiz_hotspot',
  '{
    "question": "Кликните на правильную область:",
    "imageUrl": "https://via.placeholder.com/400x300",
    "correctAreas": [
      {"id": "area-1", "x": 50, "y": 50, "radius": 30, "label": "Центр"}
    ],
    "allowMultiple": false,
    "tolerance": 20,
    "points": 1
  }'::jsonb,
  4
);