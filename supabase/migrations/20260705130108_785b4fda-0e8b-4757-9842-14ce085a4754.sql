
CREATE OR REPLACE FUNCTION public.notify_admins_on_ticket_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/ticket-message-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E';
BEGIN
  -- Only client-authored, non-internal messages should ping admins.
  IF COALESCE(NEW.is_internal, false) = true THEN
    RETURN NEW;
  END IF;
  IF NEW.author_type IS DISTINCT FROM 'user' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      body := jsonb_build_object(
        'ticket_id', NEW.ticket_id,
        'message_id', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_admins_on_ticket_message: pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_ticket_message ON public.ticket_messages;
CREATE TRIGGER trg_notify_admins_on_ticket_message
AFTER INSERT ON public.ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_on_ticket_message();
