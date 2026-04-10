-- =============================================
-- Admin MFA lockout recovery audit infrastructure.
--
-- Provides an audit log table and a logging RPC so every emergency
-- MFA reset is recorded. The RPC is callable only with the
-- service_role key.
-- =============================================

-- ── Audit log table ──
CREATE TABLE IF NOT EXISTS public.admin_mfa_resets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  target_email   text NOT NULL,
  reset_method   text NOT NULL DEFAULT 'edge_function',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_mfa_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_mfa_resets: admin read" ON public.admin_mfa_resets;
CREATE POLICY "admin_mfa_resets: admin read"
  ON public.admin_mfa_resets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ── Logging RPC (service_role only) ──
CREATE OR REPLACE FUNCTION public.log_mfa_reset(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_user_id uuid;
  v_caller  text;
BEGIN
  v_caller := coalesce(
    current_setting('request.jwt.claim.role', true),
    'unknown'
  );
  IF v_caller != 'service_role' THEN
    RAISE EXCEPTION 'log_mfa_reset requires service_role key. Current role: %', v_caller;
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = target_email;

  INSERT INTO public.admin_mfa_resets (target_user_id, target_email, reset_method)
  VALUES (
    coalesce(v_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    target_email,
    'edge_function'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.log_mfa_reset(text) TO service_role;
