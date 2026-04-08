import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, AlertCircle, Calendar, Clock, Users } from 'lucide-react';

interface RecommendedShift {
  shift_id: string;
  title: string;
  shift_date: string;
  time_type: string;
  start_time: string | null;
  end_time: string | null;
  department_name: string;
  total_slots: number;
  booked_slots: number;
  fill_ratio: number;
  total_score: number;
  organizational_need: number;
  requires_bg_check: boolean;
  score_breakdown: unknown;
}

interface RecommendedShiftsProps {
  onBookShift: (shiftId: string, shiftData?: RecommendedShift) => void;
  /** Bump to force a refresh after a successful booking */
  refreshKey?: number;
}
export function RecommendedShifts({ onBookShift, refreshKey = 0 }: RecommendedShiftsProps) {
  const [shifts, setShifts] = useState<RecommendedShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    async function loadRecommendations() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Get volunteer's booking window from their profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('extended_booking')
          .eq('id', user.id)
          .single();

        const maxDays = profileData?.extended_booking ? 21 : 14;

        // Pre-fetch the user's active bookings so we can filter them out
        const { data: myBookings } = await supabase
          .from('shift_bookings')
          .select('shift_id')
          .eq('volunteer_id', user.id)
          .in('booking_status', ['confirmed', 'waitlisted']);
        const bookedIds = new Set((myBookings || []).map((b) => b.shift_id));

        // Helper: compute a shift's end datetime using time_type defaults
        const shiftEndAt = (s: Pick<RecommendedShift, 'shift_date' | 'time_type' | 'end_time'>): Date => {
          const endStr =
            s.end_time ||
            (s.time_type === 'morning'
              ? '12:00:00'
              : s.time_type === 'afternoon'
              ? '16:00:00'
              : '17:00:00');
          return new Date(`${s.shift_date}T${endStr}`);
        };
        const now = new Date();
        const filterRelevant = (list: RecommendedShift[]) =>
          list.filter((s) =>
            !bookedIds.has(s.shift_id) &&
            shiftEndAt(s) > now &&
            // Don't recommend full shifts — they're still visible in
            // Browse Shifts so users can choose to join the waitlist,
            // but we shouldn't actively push them.
            s.booked_slots < s.total_slots
          );

        const { data, error } = await (supabase as any).rpc(
          'score_shifts_for_volunteer',
          { p_volunteer_id: user.id, p_max_days: maxDays }
        );

        if (error) throw error;

        if (data && data.length > 0) {
          const filtered = filterRelevant(data as RecommendedShift[]);
          setShifts(filtered);
          const breakdown = data[0]?.score_breakdown as any;
          setHasHistory(breakdown?.has_history ?? false);
        } else {
          // Fallback: upcoming unfilled shifts sorted by date (local timezone)
          const localToday = (() => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          })();
          const { data: fallback } = await supabase
            .from('shifts')
            .select('*, departments(name)')
            .neq('status', 'cancelled')
            .neq('status', 'full')
            .gte('shift_date', localToday)
            .order('shift_date', { ascending: true })
            .limit(20);

          if (fallback) {
            const mapped: RecommendedShift[] = fallback.map((s: any) => ({
              shift_id: s.id,
              title: s.title,
              shift_date: s.shift_date,
              time_type: s.time_type,
              start_time: s.start_time,
              end_time: s.end_time,
              department_name: s.departments?.name ?? '',
              total_slots: s.total_slots,
              booked_slots: s.booked_slots,
              fill_ratio:
                s.total_slots > 0 ? s.booked_slots / s.total_slots : 0,
              total_score: 0,
              organizational_need: 0,
              requires_bg_check: s.requires_bg_check,
              score_breakdown: null,
            }));
            setShifts(filterRelevant(mapped).slice(0, 6));
          }
        }
      } catch (err) {
        console.log('Recommendations failed, showing fallback:', err);
      } finally {
        setLoading(false);
      }
    }

    loadRecommendations();
  }, [refreshKey]);

  const formatTime = (time: string | null) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  const getSlotsLeft = (shift: RecommendedShift) =>
    shift.total_slots - shift.booked_slots;

  if (loading) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-5 h-5 text-[#006B3E]" />
          <h2 className="text-lg font-semibold text-gray-800">
            Recommended for You
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (shifts.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-5 h-5 text-[#006B3E]" />
        <h2 className="text-lg font-semibold text-gray-800">
          {hasHistory
            ? 'Recommended Based on Your Preferences'
            : 'Popular Shifts to Get Started'}
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shifts.map((shift) => (
          <Card
            key={shift.shift_id}
            className="border border-gray-200 hover:border-[#006B3E] 
                       hover:shadow-md transition-all duration-200"
          >
            <CardContent className="p-4">
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2 flex-1 mr-2">
                  {shift.title}
                </h3>
                <div className="flex flex-col gap-1 items-end flex-shrink-0">
                  {shift.organizational_need > 0.7 && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0.5 whitespace-nowrap">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      High Need
                    </Badge>
                  )}
                  {shift.requires_bg_check && (
                    <Badge
                      variant="outline"
                      className="text-xs px-1.5 py-0.5 whitespace-nowrap"
                    >
                      BG Check
                    </Badge>
                  )}
                </div>
              </div>

              {/* Department */}
              <p className="text-xs text-[#006B3E] font-medium mb-2">
                {shift.department_name}
              </p>

              {/* Date & Time */}
              <div className="space-y-1 mb-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{formatDate(shift.shift_date)}</span>
                </div>
                {shift.start_time && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {formatTime(shift.start_time)}
                      {shift.end_time && ` – ${formatTime(shift.end_time)}`}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    {getSlotsLeft(shift)} slot
                    {getSlotsLeft(shift) !== 1 ? 's' : ''} left
                  </span>
                </div>
              </div>

              {/* Fill bar */}
              <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
                <div
                  className="bg-[#006B3E] h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.round(shift.fill_ratio * 100)}%`,
                  }}
                />
              </div>

              {/* Book button */}
              <Button
                size="sm"
                className="w-full bg-[#006B3E] hover:bg-[#005a32] text-white text-xs h-8"
                onClick={() => onBookShift(shift.shift_id, shift)}
              >
                Book Shift
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}