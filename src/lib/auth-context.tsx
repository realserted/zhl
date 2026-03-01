'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string, phone?: string, extra?: {
    descriptor?: string; companyName?: string; personName?: string;
    username?: string; accountNumber?: string; notes?: string;
  }) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName: string, phone?: string, extra?: {
    descriptor?: string; companyName?: string; personName?: string;
    username?: string; accountNumber?: string; notes?: string;
  }) => {
    // Block admin email from public registration
    if (email.toLowerCase() === 'admin@zhl.com') {
      return { error: 'This email address is reserved and cannot be used for registration.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, phone: phone || null },
      },
    });

    if (error) return { error: error.message };

    // Create the account record in our accounts table
    if (data.user) {
      const { error: accountError } = await supabase
        .from('zhl_accounts')
        .upsert(
          [
            {
              user_id: data.user.id,
              display_name: displayName,
              email,
              phone: phone || null,
              password_hash: 'managed_by_supabase_auth',
              descriptor: extra?.descriptor || null,
              company_name: extra?.companyName || null,
              person_name: extra?.personName || null,
              username: extra?.username || null,
              account_number: extra?.accountNumber || null,
              notes: extra?.notes || null,
            },
          ],
          { onConflict: 'user_id' }
        );
      if (accountError) {
        const details = [accountError.code, accountError.message, accountError.details, accountError.hint]
          .filter(Boolean)
          .map((v) => String(v))
          .join(' | ');
        console.warn('Account profile sync skipped:', details || 'Unknown error');
      }
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
