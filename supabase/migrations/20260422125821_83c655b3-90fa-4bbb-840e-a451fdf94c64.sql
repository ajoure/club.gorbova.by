INSERT INTO public.live_event_room_blocks (
  live_event_id, block_type, display_scope, position, sort_order, is_active, config, created_by
) VALUES
(
  '12fa6a63-5ca7-4841-bde0-d04ba7aed063'::uuid,
  'banner',
  'always',
  'under_video',
  9001,
  true,
  jsonb_build_object(
    'proof_tag', 'T1-OVERFLOW-PROOF-20260422',
    'title', 'BANNER-T1-OVERFLOW-PROOF-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'body', 'https://example.com/very-long-url-without-any-spaces/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  (SELECT id FROM auth.users LIMIT 1)
),
(
  '12fa6a63-5ca7-4841-bde0-d04ba7aed063'::uuid,
  'text',
  'always',
  'under_video',
  9002,
  true,
  jsonb_build_object(
    'proof_tag', 'T1-OVERFLOW-PROOF-20260422',
    'title', 'TEXT-T1-OVERFLOW-PROOF',
    'body', 'TEXT-OVERFLOW-CHECK: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA https://example.com/another-extremely-long-url-without-any-spaces-at-all/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  (SELECT id FROM auth.users LIMIT 1)
);