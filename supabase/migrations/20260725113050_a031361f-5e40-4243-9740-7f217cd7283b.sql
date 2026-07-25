
CREATE OR REPLACE FUNCTION public.referral_ensure_registration_link(_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _new uuid;
BEGIN
  SELECT id INTO _existing
  FROM public.referral_program_links
  WHERE partner_id = _partner_id
    AND status = 'active'
    AND target_path = '/'
    AND product_id IS NULL
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.referral_program_links (partner_id, title, target_path, program_kind, status)
  VALUES (_partner_id, 'Регистрация', '/', 'free', 'active')
  RETURNING id INTO _new;

  RETURN _new;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_ensure_registration_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_ensure_registration_link(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_partners_ensure_link_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    PERFORM public.referral_ensure_registration_link(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referral_partners_ensure_link ON public.referral_partners;
CREATE TRIGGER referral_partners_ensure_link
AFTER INSERT OR UPDATE OF status ON public.referral_partners
FOR EACH ROW EXECUTE FUNCTION public.referral_partners_ensure_link_trg();
