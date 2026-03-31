import { supabase } from "@/integrations/supabase/client";

interface SendEmailOptions {
  to: string;
  type: string;
  subject?: string;
  html?: string;
  shiftTitle?: string;
  shiftDate?: string;
  shiftTime?: string;
  department?: string;
  selectedSlots?: string;
  volunteerName?: string;
  coordinatorName?: string;
  bookingId?: string;
  totalHours?: number;
  resetLink?: string;
  daysSinceShift?: number;
  cancellationTime?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("send-email", {
      body: options,
    });
    if (error) {
      console.error("Email send error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Email send failed:", e);
    return false;
  }
}
