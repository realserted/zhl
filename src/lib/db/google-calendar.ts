import { supabase } from '@/lib/supabase/client';

/** Check if the current user has connected Google Calendar. */
export async function getGoogleCalendarStatus(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('zhl_google_tokens')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
