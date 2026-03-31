
-- Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Replace the trigger function to use pg_net to call the edge function
CREATE OR REPLACE FUNCTION public.notify_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  profile_rec record;
  payload jsonb;
  supabase_url text;
  service_key text;
begin
  -- Get user profile
  select email, full_name, notif_email 
  into profile_rec 
  from public.profiles 
  where id = new.user_id;

  -- Only send if user has email notifications enabled
  if profile_rec.notif_email = false then
    return new;
  end if;

  -- Build payload
  payload := jsonb_build_object(
    'record', jsonb_build_object(
      'id', new.id,
      'user_id', new.user_id,
      'type', new.type,
      'title', new.title,
      'message', new.message,
      'link', new.link
    )
  );

  -- Get Supabase URL from vault or use hardcoded project URL
  supabase_url := 'https://esycmohgumryeqteiwla.supabase.co';

  -- Call the notification-webhook edge function via pg_net
  perform extensions.http_post(
    url := supabase_url || '/functions/v1/notification-webhook',
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeWNtb2hndW1yeWVxdGVpd2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTYyMDksImV4cCI6MjA5MDMzMjIwOX0.Qa6683q4MwKzWEMGgEB-fQG8jiSJw3xoZp4b6GyaAf8'
    )::jsonb
  );
  
  return new;
end;
$$;
