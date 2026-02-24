import { supabase } from '@/lib/supabase/client';
import { Notification } from '@/lib/types/notification';

// Whether the cleared_at column exists (detected on first query failure).
// Flips to false if the migration hasn't been run yet, so queries fall back gracefully.
let clearedAtSupported = true;

/** Get latest 50 notifications for a user, newest first. Excludes cleared notifications. */
export async function getNotifications(userId: string): Promise<Notification[]> {
  if (clearedAtSupported) {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .is('cleared_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error) return data ?? [];
    // Column likely missing — fall back and stop trying
    clearedAtSupported = false;
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
  return data ?? [];
}

/** Get count of unread notifications. Excludes cleared notifications. */
export async function getUnreadCount(userId: string): Promise<number> {
  if (clearedAtSupported) {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('cleared_at', null);

    if (!error) return count ?? 0;
    clearedAtSupported = false;
  }

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    console.error('Error fetching unread count:', error);
    return 0;
  }
  return count ?? 0;
}

/** Mark a single notification as read. */
export async function markAsRead(notificationId: string): Promise<boolean> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) {
    console.error('Error marking notification as read:', error);
    return false;
  }
  return true;
}

/** Mark all notifications as read for a user. */
export async function markAllAsRead(userId: string): Promise<boolean> {
  const query = supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);

  const { error } = await (clearedAtSupported ? query.is('cleared_at', null) : query);

  if (error) {
    console.error('Error marking all notifications as read:', error);
    return false;
  }
  return true;
}

/** Soft-clear all notifications for a user (sets cleared_at; rows remain in DB for monitoring).
 *  Requires migration 20260222000001_notifications_soft_clear.sql to be applied in Supabase. */
export async function deleteAllNotifications(userId: string): Promise<boolean> {
  if (!clearedAtSupported) {
    // Migration not yet applied — nothing to soft-clear
    console.warn('cleared_at column missing. Run migration 20260222000001_notifications_soft_clear.sql in Supabase.');
    return false;
  }

  const { error } = await supabase
    .from('notifications')
    .update({ cleared_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('cleared_at', null);

  if (error) {
    console.error('Error clearing notifications:', error);
    return false;
  }
  return true;
}

/** Create a notification for any user.
 *
 *  Uses the `create_notification_for_user` SECURITY DEFINER RPC so that
 *  project owners can notify other users even though RLS only allows each
 *  user to insert notifications for themselves.
 *
 *  Requires migration 20260224000003_create_notification_rpc.sql to be
 *  applied in Supabase.
 */
export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  relatedType?: string;
}): Promise<boolean> {
  const { error } = await supabase.rpc('create_notification_for_user', {
    p_user_id: params.userId,
    p_type: params.type,
    p_title: params.title,
    p_message: params.message,
    p_related_id: params.relatedId ?? null,
    p_related_type: params.relatedType ?? null,
  });

  if (error) {
    console.error('Error creating notification:', error);
    return false;
  }
  return true;
}
