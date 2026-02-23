import { supabase } from '@/lib/supabase/client';
import { Account, AccountInsert, AccountUpdate } from '@/lib/types/account';

// Get current user's account
export async function getAccount(userId: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching account:', error);
    return null;
  }
  return data;
}

// Create a new account
export async function createAccount(
  accountData: AccountInsert
): Promise<Account | null> {
  const { data, error } = await supabase
    .from('accounts')
    .insert([accountData])
    .select()
    .single();

  if (error) {
    console.error('Error creating account:', error);
    return null;
  }
  return data;
}

// Update an account
export async function updateAccount(
  userId: string,
  updates: AccountUpdate
): Promise<Account | null> {
  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating account:', error);
    return null;
  }
  return data;
}

// Delete an account
export async function deleteAccount(userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting account:', error);
    return false;
  }
  return true;
}

// Check if account exists
export async function accountExists(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    console.error('Error checking account existence:', error);
    return false;
  }
  return (count ?? 0) > 0;
}
