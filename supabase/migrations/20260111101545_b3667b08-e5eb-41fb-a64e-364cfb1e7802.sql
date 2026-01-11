-- Create table to store card-to-profile links for automatic matching
CREATE TABLE IF NOT EXISTS card_profile_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_last4 TEXT NOT NULL,
  card_brand TEXT,
  card_holder TEXT,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(card_last4, card_holder)
);

-- Enable RLS
ALTER TABLE card_profile_links ENABLE ROW LEVEL SECURITY;

-- Admin can manage all card links
CREATE POLICY "Admins can manage card links"
ON card_profile_links
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- Create indexes for faster lookups
CREATE INDEX idx_card_profile_links_card ON card_profile_links(card_last4);
CREATE INDEX idx_card_profile_links_profile ON card_profile_links(profile_id);