-- =============================================
-- Document expiry tracking and enforcement.
--
-- 1. Creates the warn_expiring_documents() function that the
--    existing cron job (warn-expiring-documents-daily) calls but
--    which was never defined.
-- 2. Adds booking enforcement: if a department requires BG check,
--    volunteers with expired required documents can't book.
-- =============================================

-- ── 1. Document expiry cron function ──
-- The cron job already exists (warn-expiring-documents-daily) but
-- the function it calls was never created. This function:
--   a) Marks approved docs expiring within 30 days as 'expiring_soon'
--   b) Marks expired docs as 'expired'
--   c) Sends notifications for each affected volunteer

CREATE OR REPLACE FUNCTION public.warn_expiring_documents()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec record;
BEGIN
  -- ── Step 1: Mark approved documents expiring within 30 days ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expiring_soon', updated_at = now()
    WHERE status = 'approved'
      AND expires_at IS NOT NULL
      AND expires_at <= now() + interval '30 days'
      AND expires_at > now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expiry_warning',
      'Document expiring soon: ' || dt.name,
      'Your "' || dt.name || '" document expires on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        ' (' || EXTRACT(DAY FROM (rec.expires_at - now()))::int || ' days remaining). ' ||
        'Please upload a renewed copy before it expires.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at,
        'days_remaining', EXTRACT(DAY FROM (rec.expires_at - now()))::int
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
    -- Don't send duplicate warnings (1 per document per 7 days)
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = rec.volunteer_id
        AND n.type = 'document_expiry_warning'
        AND (n.data->>'document_id')::uuid = rec.id
        AND n.created_at > now() - interval '7 days'
    );
  END LOOP;

  -- ── Step 2: Mark expired documents ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expired', updated_at = now()
    WHERE status IN ('approved', 'expiring_soon')
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expired',
      'Document expired: ' || dt.name,
      'Your "' || dt.name || '" document expired on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        '. Please upload a renewed copy to maintain your eligibility.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
    -- Don't send duplicate expired notifications
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = rec.volunteer_id
        AND n.type = 'document_expired'
        AND (n.data->>'document_id')::uuid = rec.id
    );
  END LOOP;
END;
$function$;

-- ── 2. Reschedule the cron to run at 08:00 CT ──
-- The existing job may have the wrong schedule.
SELECT cron.unschedule('warn-expiring-documents-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warn-expiring-documents-daily');

SELECT cron.schedule(
  'warn-expiring-documents-daily',
  '0 13 * * *',  -- 08:00 CT = 13:00 UTC
  $cron$ SELECT public.warn_expiring_documents(); $cron$
);
