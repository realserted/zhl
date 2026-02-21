import { supabase } from '../supabase';
import { Notification } from '../types/notification';

/** Get latest 50 notifications for a user, newest first. */
export async function getNotifications(userId: string): Promise<Notification[]> {
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

/** Get count of unread notifications. */
export async function getUnreadCount(userId: string): Promise<number> {
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
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    console.error('Error marking all notifications as read:', error);
    return false;
  }
  return true;
}

/** Create a notification. */
export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  relatedType?: string;
}): Promise<boolean> {
  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    related_id: params.relatedId ?? null,
    related_type: params.relatedType ?? null,
  });

  if (error) {
    console.error('Error creating notification:', error);
    return false;
  }
  return true;
}
