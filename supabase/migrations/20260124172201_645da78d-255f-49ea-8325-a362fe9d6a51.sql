-- Fix create_support_ticket function to include description field
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_description text,
  p_category text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile_id uuid;
  v_ticket_id uuid;
  v_ticket_number text;
  v_trimmed_description text;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not authenticated',
      'error_code', 'not_authenticated'
    );
  END IF;
  
  -- Get profile_id
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE user_id = v_user_id;
  
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile not found',
      'error_code', 'profile_not_found'
    );
  END IF;
  
  -- Validate description
  v_trimmed_description := NULLIF(trim(p_description), '');
  
  IF v_trimmed_description IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Description is required',
      'error_code', 'description_required'
    );
  END IF;
  
  -- Generate ticket number atomically
  v_ticket_number := generate_ticket_number_atomic();
  
  -- Create ticket with description
  INSERT INTO support_tickets (
    user_id,
    profile_id,
    subject,
    description,
    category,
    ticket_number,
    status,
    priority,
    has_unread_admin,
    has_unread_user,
    updated_at
  ) VALUES (
    v_user_id,
    v_profile_id,
    p_subject,
    v_trimmed_description,
    COALESCE(p_category, 'general'),
    v_ticket_number,
    'open',
    'normal',
    true,
    false,
    now()
  )
  RETURNING id INTO v_ticket_id;
  
  -- Create first message
  INSERT INTO ticket_messages (
    ticket_id,
    author_id,
    author_type,
    message,
    is_internal,
    is_read
  ) VALUES (
    v_ticket_id,
    v_user_id,
    'user',
    v_trimmed_description,
    false,
    false
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', 'database_error'
  );
END;
$$;

-- Fix ticket counter initialization to use correct parsing
-- Reset counter with proper max value extraction
DO $$
DECLARE
  v_current_year int := EXTRACT(YEAR FROM now())::int;
  v_max_seq int;
BEGIN
  -- Find max sequence from existing tickets for current year
  -- Format: TKT-YY-NNNNN, extract only the last part after second dash
  SELECT COALESCE(
    MAX(
      CASE 
        WHEN ticket_number ~ '^TKT-[0-9]{2}-[0-9]+$' 
        THEN NULLIF(split_part(ticket_number, '-', 3), '')::int
        ELSE 0
      END
    ), 
    0
  ) INTO v_max_seq
  FROM support_tickets
  WHERE ticket_number LIKE 'TKT-' || to_char(now(), 'YY') || '-%';
  
  -- Update or insert counter
  INSERT INTO support_ticket_counters (year, seq)
  VALUES (v_current_year, v_max_seq)
  ON CONFLICT (year) DO UPDATE SET seq = GREATEST(support_ticket_counters.seq, v_max_seq);
END $$;