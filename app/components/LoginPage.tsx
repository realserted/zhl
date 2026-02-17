'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth-context';
import { useTheme } from 'next-themes';
import Image from 'next/image';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (isSignUp) {
      if (!displayName.trim()) {
        setError('Display name is required');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, displayName, phone);
      if (error) {
        setError(error);
      } else {
        setSignUpSuccess(true);
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
      }
    }

    setLoading(false);
  };

  if (signUpSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-green-600 dark:text-green-400 text-xl">&#10003;</span>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Check your email</h2>
            <p className="text-muted-foreground text-sm mb-6">
              We sent a confirmation link to <strong>{email}</strong>. Please verify your email to continue.
            </p>
            <button
              onClick={() => {
                setIsSignUp(false);
                setSignUpSuccess(false);
                setEmail('');
                setPassword('');
                setDisplayName('');
                setPhone('');
              }}
              className="text-sm text-green-400 hover:underline font-medium"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          {mounted && (
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
          )}
          <p className="text-sm text-muted-foreground mt-4">Property management simplified</p>
        </div>

        {/* Form Card */}
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-6">
            {isSignUp ? 'Create your account' : 'Sign in to your account'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">
                    Display Name
                  </label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="John Doe"
                    required
                    className="w-full px-3 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1.5">
                    Phone Number <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-3 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
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
              disabled={loading}
              className="w-full py-2.5 bg-black text-green-400 rounded-lg text-sm font-semibold hover:bg-gray-900 transition-colors disabled:opacity-50 border border-green-400"
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
                className="text-green-400 font-medium hover:underline"
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
