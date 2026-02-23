// Account table types for Supabase
export interface Account {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export type AccountInsert = Omit<Account, 'id' | 'created_at' | 'updated_at'>;
export type AccountUpdate = Partial<Omit<Account, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
