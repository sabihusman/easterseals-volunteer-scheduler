-- =============================================
-- CRITICAL FIX: notify_email_on_notification was calling a
-- nonexistent function:
--   extensions.http_post(url text, body text, headers jsonb)
-- The real function is net.http_post(url text, body jsonb, ...)
-- in the pg_net-owned `net` schema. Every notification insert
-- for a user with notif_email = true was raising 42883 and
-- rolling back the parent transaction.
--
-- Impact: admin_action_off_shift, admin_delete_unactioned_shift,
-- waitlist promotions, and every other flow that inserts a
-- notification as part of its work silently failed.
--
-- Fix:
--   1. Switch to net.http_post with the correct argument types.
--   2. Wrap the http_post call in a BEGIN/EXCEPTION block so that
--      a webhook failure NEVER blocks the notification row from
--      being inserted. The worst case becomes "email wasn't sent"
--      instead of "the entire operation failed".
-- =============================================

CREATE OR REPLACE FUNCTION public.notify_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  profile_rec record;
  payload jsonb;
  supabase_url text := 'https://esycmohgumryeqteiwla.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeWNtb2hndW1yeWVxdGVpd2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTYyMDksImV4cCI6MjA5MDMzMjIwOX0.Qa6683q4MwKzWEMGgEB-fQG8jiSJw3xoZp4b6GyaAf8';
BEGIN
  SELECT email, full_name, notif_email
    INTO profile_rec
    FROM public.profiles
    WHERE id = NEW.user_id;

  IF profile_rec.notif_email IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'record', jsonb_build_object(
      'id',      NEW.id,
      'user_id', NEW.user_id,
      'type',    NEW.type,
      'title',   NEW.title,
      'message', NEW.message,
      'link',    NEW.link,
      'data',    NEW.data
    )
  );

  -- Never let webhook failures roll back the surrounding transaction.
  BEGIN
    PERFORM net.http_post(
      url     := supabase_url || '/functions/v1/notification-webhook',
      body    := payload,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || anon_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't propagate
    RAISE WARNING 'notify_email_on_notification webhook failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
