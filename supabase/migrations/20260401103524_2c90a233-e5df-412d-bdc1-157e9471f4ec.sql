
-- Fix extended mirrors: set active_until to NULL for users with unlimited canonical access
-- These 11 users have unlimited access (NULL expiry) but mirrors show finite dates
UPDATE telegram_access 
SET active_until = NULL, updated_at = now()
WHERE (user_id, club_id) IN (
  ('83bc38bc-2498-4760-b6fd-f0494055106c', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('84feb5b9-064b-4bfb-96ce-b3271e85e3a5', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('f7690c11-1e72-4c65-a525-26ddff89b28a', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('6ae5cc6e-81f5-4920-bdf6-805eb700de12', '4f8f9d8f-07ce-4898-8012-39f1035c1456'),
  ('192d7213-6fca-40fa-9a9d-12abaec9ab32', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('9a970da3-0b7b-4d6a-bd83-a5ae71176d20', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('c2f16b77-b366-4e93-944b-a2793216193c', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('0a15714f-0371-499f-84a0-1db67d1d4600', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('587a0856-d13c-4a89-8947-76a356227580', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('01464367-cd9b-4a39-afed-496b38ec8f7b', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('9267a27e-56e9-49ea-a6b5-3a2069840dcc', 'fa547c41-3a84-4c4f-904a-427332a0506e')
);

-- Also update telegram_access_grants for these users
UPDATE telegram_access_grants
SET end_at = NULL, updated_at = now()
WHERE (user_id, club_id) IN (
  ('83bc38bc-2498-4760-b6fd-f0494055106c', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('84feb5b9-064b-4bfb-96ce-b3271e85e3a5', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('f7690c11-1e72-4c65-a525-26ddff89b28a', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('6ae5cc6e-81f5-4920-bdf6-805eb700de12', '4f8f9d8f-07ce-4898-8012-39f1035c1456'),
  ('192d7213-6fca-40fa-9a9d-12abaec9ab32', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('9a970da3-0b7b-4d6a-bd83-a5ae71176d20', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('c2f16b77-b366-4e93-944b-a2793216193c', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('0a15714f-0371-499f-84a0-1db67d1d4600', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('587a0856-d13c-4a89-8947-76a356227580', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('01464367-cd9b-4a39-afed-496b38ec8f7b', 'fa547c41-3a84-4c4f-904a-427332a0506e'),
  ('9267a27e-56e9-49ea-a6b5-3a2069840dcc', 'fa547c41-3a84-4c4f-904a-427332a0506e')
)
AND status = 'active';
