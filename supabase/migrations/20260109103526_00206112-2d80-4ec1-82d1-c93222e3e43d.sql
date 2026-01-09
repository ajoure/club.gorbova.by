-- Add is_read column to telegram_messages for tracking unread messages
ALTER TABLE public.telegram_messages 
ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;

-- Create index for fast unread message queries
CREATE INDEX IF NOT EXISTS idx_telegram_messages_unread 
ON public.telegram_messages(user_id, is_read) 
WHERE is_read = false AND direction = 'incoming';

-- Enable realtime for telegram_messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_messages;