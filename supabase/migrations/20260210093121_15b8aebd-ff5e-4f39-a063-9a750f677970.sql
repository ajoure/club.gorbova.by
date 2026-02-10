
-- ============================================
-- P2.2: Reactions on ticket messages
-- ============================================

CREATE TABLE IF NOT EXISTS public.ticket_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.ticket_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_ticket_message_reactions_message_id 
  ON public.ticket_message_reactions(message_id);

ALTER TABLE public.ticket_message_reactions ENABLE ROW LEVEL SECURITY;

-- SELECT: ticket owner + admins
CREATE POLICY "Users can view reactions on accessible ticket messages"
  ON public.ticket_message_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ticket_messages tm
      JOIN public.support_tickets st ON st.id = tm.ticket_id
      WHERE tm.id = ticket_message_reactions.message_id 
        AND (st.user_id = auth.uid())
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'superadmin')
  );

-- INSERT: own reactions only
CREATE POLICY "Users can add own reactions"
  ON public.ticket_message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- DELETE: own reactions only  
CREATE POLICY "Users can remove own reactions"
  ON public.ticket_message_reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_message_reactions;

-- ============================================
-- P0/P2: Telegram Bridge columns + sync table
-- ============================================

ALTER TABLE public.support_tickets 
  ADD COLUMN IF NOT EXISTS telegram_bridge_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_user_id bigint;

CREATE TABLE IF NOT EXISTS public.ticket_telegram_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  ticket_message_id uuid REFERENCES public.ticket_messages(id) ON DELETE SET NULL,
  telegram_message_id bigint,
  direction text NOT NULL CHECK (direction IN ('to_telegram', 'from_telegram')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_message_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_ticket_telegram_sync_ticket 
  ON public.ticket_telegram_sync(ticket_id);

ALTER TABLE public.ticket_telegram_sync ENABLE ROW LEVEL SECURITY;

-- Admin only
CREATE POLICY "Admins can manage telegram sync"
  ON public.ticket_telegram_sync FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'superadmin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'superadmin')
  );
