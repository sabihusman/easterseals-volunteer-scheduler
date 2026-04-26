import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface VolunteerReliabilityBadgeProps {
  volunteerId: string;
}

interface ReliabilityData {
  reliability_alpha: number;
  reliability_beta: number;
  total_interactions: number;
}

type ReliabilityTier = 'new' | 'reliable' | 'watch' | 'concern';

function getTier(mean: number, confidence: number): ReliabilityTier {
  if (confidence < 5) return 'new';
  if (mean > 0.8) return 'reliable';
  if (mean >= 0.5) return 'watch';
  return 'concern';
}

const tierConfig: { [key: string]: { label: string; className: string } } = {
  new: {
    label: 'New',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  reliable: {
    label: 'Reliable',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  watch: {
    label: 'Watch',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  concern: {
    label: 'Concern',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
};

export function VolunteerReliabilityBadge({
  volunteerId,
}: VolunteerReliabilityBadgeProps) {
  const [data, setData] = useState<ReliabilityData | null>(null);

  useEffect(() => {
    (supabase as any)
      .from('volunteer_preferences')
      .select('reliability_alpha, reliability_beta, total_interactions')
      .eq('volunteer_id', volunteerId)
      .maybeSingle()
      .then(({ data }: { data: ReliabilityData | null }) => {
        if (data) setData(data);
      });
  }, [volunteerId]);

  if (!data) {
    return (
      <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs">
        New
      </Badge>
    );
  }

  const mean =
    data.reliability_alpha / (data.reliability_alpha + data.reliability_beta);
  const confidence = data.reliability_alpha + data.reliability_beta;
  const tier = getTier(mean, confidence);
  const config = tierConfig[tier];
  const completionPct = Math.round(mean * 100);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={`${config.className} text-xs cursor-help border`}>
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            Based on {data.total_interactions} interaction
            {data.total_interactions !== 1 ? 's' : ''} —{' '}
            {completionPct}% completion rate
          </p>
          {confidence < 5 && (
            <p className="text-xs text-gray-400 mt-0.5">
              Not enough data yet
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}