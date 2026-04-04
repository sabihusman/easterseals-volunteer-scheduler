import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

type InteractionType = 'viewed' | 'signed_up' | 'cancelled' | 'completed' | 'no_show';

export function useInteractionTracking() {
  const trackInteraction = useCallback(
    async (shiftId: string, interactionType: InteractionType) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fire and forget — never await this in the UI
        supabase
          .from('volunteer_shift_interactions')
          .insert({
            volunteer_id: user.id,
            shift_id: shiftId,
            interaction_type: interactionType,
          })
          .then(({ error }) => {
            if (error) console.log('Interaction tracking failed silently:', error.message);
          });
      } catch (err) {
        // Never surface tracking errors to the user
        console.log('Interaction tracking error:', err);
      }
    },
    []
  );

  const trackViewed = useCallback(
    (shiftId: string) => trackInteraction(shiftId, 'viewed'),
    [trackInteraction]
  );

  const trackSignedUp = useCallback(
    (shiftId: string) => trackInteraction(shiftId, 'signed_up'),
    [trackInteraction]
  );

  const trackCancelled = useCallback(
    (shiftId: string) => trackInteraction(shiftId, 'cancelled'),
    [trackInteraction]
  );

  const trackCompleted = useCallback(
    (shiftId: string) => trackInteraction(shiftId, 'completed'),
    [trackInteraction]
  );

  const trackNoShow = useCallback(
    (shiftId: string) => trackInteraction(shiftId, 'no_show'),
    [trackInteraction]
  );

  return {
    trackViewed,
    trackSignedUp,
    trackCancelled,
    trackCompleted,
    trackNoShow,
  };
}
