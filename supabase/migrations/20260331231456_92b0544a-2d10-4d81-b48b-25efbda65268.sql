
-- Create a trigger function that calls the notification-webhook edge function
-- when a new notification is inserted
CREATE OR REPLACE FUNCTION public.notify_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  profile_rec record;
  payload jsonb;
begin
  -- Get user profile for email
  select email, full_name, notif_email 
  into profile_rec 
  from public.profiles 
  where id = new.user_id;

  -- Only send if user has email notifications enabled
  if profile_rec.notif_email = false then
    return new;
  end if;

  -- Build payload and use pg_net to call the edge function
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

  -- Use pg_notify to signal the notification (the edge function webhook handles the rest)
  perform pg_notify('new_notification', payload::text);
  
  return new;
end;
$$;

-- Create the trigger on notifications table
DROP TRIGGER IF EXISTS trg_email_on_notification ON public.notifications;
CREATE TRIGGER trg_email_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_email_on_notification();
