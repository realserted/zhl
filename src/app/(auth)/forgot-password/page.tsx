'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { ShieldCheck, Mail, ArrowLeft } from 'lucide-react';

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (status === 'sent') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2 text-center">Check your email</h2>
            <p className="text-muted-foreground text-sm mb-6 text-center">
              We sent a password reset link to <strong>{email}</strong>. Click the link in the email to set a new password.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full text-sm text-green-400 hover:underline font-medium text-center"
            >
              Back to sign in
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-4 text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="text-xs">Secured with end-to-end encryption</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        {mounted && (
          <div className="text-center mb-8">
            <div className="mb-6">
              <Image
                src={theme === 'dark' ? '/zhl-logo-light.png' : '/zhl-logo-dark.png'}
                alt="Zero Hassle Landlord"
                width={300}
                height={120}
                priority
                className="h-24 w-auto mx-auto"
              />
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <button
            onClick={() => router.push('/login')}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-lg font-semibold text-foreground mb-2">Reset your password</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = email.trim().toLowerCase();
              if (!validateEmail(trimmed)) {
                setError('Please enter a valid email address.');
                setStatus('error');
                return;
              }
              setStatus('sending');
              setError(null);
              const { error: resetError } = await resetPassword(trimmed);
              if (resetError) {
                setError(resetError);
                setStatus('error');
              } else {
                setStatus('sent');
              }
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="forgotEmail" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="forgotEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                maxLength={255}
                className="w-full px-3 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-2.5 bg-black text-green-400 rounded-lg text-sm font-semibold hover:bg-gray-900 transition-colors disabled:opacity-50 border border-green-400"
            >
              {status === 'sending' ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-4 text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-xs">Secured with end-to-end encryption</span>
        </div>
      </div>
    </main>
  );
}
