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
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resendVerification: (email: string, password: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  /** Ensure zhl_accounts row exists for the given user (upsert, non-blocking). */
  const ensureAccount = async (u: User) => {
    try {
      await fetch('/api/auth/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: u.id,
          display_name:
            u.user_metadata?.display_name ||
            u.user_metadata?.full_name ||
            u.email?.split('@')[0] ||
            'User',
          email: u.email!,
          phone: u.user_metadata?.phone || null,
        }),
      });
    } catch {
      // Non-blocking — account may already exist
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // On sign-in, ensure the user has a zhl_accounts row
      if (event === 'SIGNED_IN' && session?.user) {
        ensureAccount(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName: string, phone?: string, extra?: {
    descriptor?: string; companyName?: string; personName?: string;
    username?: string; accountNumber?: string; notes?: string;
  }) => {
    // Block admin email from public registration
    if (email.toLowerCase() === 'presaling@gmail.com') {
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

    // Create the account record via server-side API (bypasses RLS since user has no session yet)
    if (data.user) {
      try {
        const res = await fetch('/api/auth/create-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: data.user.id,
            display_name: displayName,
            email,
            phone: phone || null,
            descriptor: extra?.descriptor || null,
            company_name: extra?.companyName || null,
            person_name: extra?.personName || null,
            username: extra?.username || null,
            account_number: extra?.accountNumber || null,
            notes: extra?.notes || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.warn('Account profile sync failed:', body.error || res.statusText);
        }
      } catch (err) {
        console.warn('Account profile sync failed:', err);
      }
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // Ensure zhl_accounts row exists for this user
    if (data.user) {
      ensureAccount(data.user);
    }

    return { error: null };
  };

  const resendVerification = async (email: string, password: string) => {
    // Supabase doesn't have a dedicated resend endpoint — calling signUp again
    // with the same credentials will re-send the confirmation email.
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/overview`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signInWithGoogle, signOut, resendVerification, resetPassword }}>
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
