-- P1: Fix card_profile_links UNIQUE constraint

-- 1) Delete duplicates (keep most recent for each last4+brand pair)
DELETE FROM card_profile_links
WHERE id NOT IN (
  SELECT DISTINCT ON (card_last4, COALESCE(card_brand, '')) id
  FROM card_profile_links
  ORDER BY card_last4, COALESCE(card_brand, ''), updated_at DESC NULLS LAST
);

-- 2) Drop old incorrect constraint
ALTER TABLE card_profile_links
DROP CONSTRAINT IF EXISTS card_profile_links_card_last4_card_holder_key;

-- 3) Add correct constraint
ALTER TABLE card_profile_links
ADD CONSTRAINT card_profile_links_card_last4_card_brand_key
UNIQUE NULLS NOT DISTINCT (card_last4, card_brand);