'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';

// Password must have: 8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character (!@#$%^&*)', test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(p) },
];

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;
const SIGNUP_COOLDOWN_SECONDS = 30;

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signupCooldownNotice, setSignupCooldownNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Rate limiting
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutCountdown, setLockoutCountdown] = useState(0);
  const [signUpCooldownUntil, setSignUpCooldownUntil] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (signUpTimerRef.current) clearInterval(signUpTimerRef.current);
    };
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (!lockoutUntil) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLockoutCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutCountdown(remaining);
      if (remaining <= 0) {
        setLockoutUntil(null);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockoutUntil]);

  // Clear signup cooldown notice once the cooldown period expires
  useEffect(() => {
    if (!signUpCooldownUntil) {
      setSignupCooldownNotice(null);
      return;
    }
    const delay = Math.max(0, signUpCooldownUntil - Date.now());
    signUpTimerRef.current = setTimeout(() => {
      setSignUpCooldownUntil(null);
    }, delay);
    return () => { if (signUpTimerRef.current) clearTimeout(signUpTimerRef.current); };
  }, [signUpCooldownUntil]);

  const isLocked = lockoutCountdown > 0;

  // Password strength score (0-5)
  const strengthScore = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const strengthLabel = strengthScore <= 1 ? 'Weak' : strengthScore <= 3 ? 'Fair' : strengthScore <= 4 ? 'Good' : 'Strong';
  const strengthColor = strengthScore <= 1 ? 'bg-red-500' : strengthScore <= 3 ? 'bg-yellow-500' : strengthScore <= 4 ? 'bg-blue-500' : 'bg-green-500';

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check cooldown/lockout
    if (!isSignUp) {
      if (isLocked) {
        setError(`Too many failed attempts. Try again in ${lockoutCountdown} seconds.`);
        return;
      }
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();

    // Validate email format
    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (isSignUp) {
      // Validate display name
      if (!trimmedName) {
        setError('Display name is required.');
        return;
      }
      if (trimmedName.length < 2) {
        setError('Display name must be at least 2 characters.');
        return;
      }

      // Validate password strength
      const failedRules = PASSWORD_RULES.filter((r) => !r.test(password));
      if (failedRules.length > 0) {
        setError(`Password requirements not met: ${failedRules.map((r) => r.label.toLowerCase()).join(', ')}.`);
        return;
      }

      // Validate password confirmation
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      setLoading(true);
      const { error } = await signUp(trimmedEmail, password, trimmedName, phone.trim());
      if (error) {
        const normalized = error.toLowerCase();
        const isRateLimitError =
          normalized.includes('email rate limit exceeded') ||
          normalized.includes('security purposes');

        if (isRateLimitError) {
          setSignUpCooldownUntil(Date.now() + SIGNUP_COOLDOWN_SECONDS * 1000);
          setError(null);
          setSignupCooldownNotice(
            `Email sending is rate limited by the server. Please wait a few minutes and try again, or ask an admin to disable email confirmation in Supabase → Authentication → Settings.`
          );
        } else {
          setSignupCooldownNotice(null);
          setError(error);
        }
      } else {
        setSignupCooldownNotice(null);
        setSignUpSuccess(true);
      }
    } else {
      setLoading(true);
      const { error } = await signIn(trimmedEmail, password);
      if (error) {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        if (attempts >= MAX_ATTEMPTS) {
          setLockoutUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          setFailedAttempts(0);
          setError(`Too many failed attempts. Account locked for ${LOCKOUT_SECONDS} seconds.`);
        } else {
          setError(`${error} (${MAX_ATTEMPTS - attempts} attempts remaining)`);
        }
      } else {
        setFailedAttempts(0);
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
              <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
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
                setConfirmPassword('');
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
      {/* Theme Toggle */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

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

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
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
                    maxLength={100}
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
                    maxLength={20}
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
                maxLength={255}
                className="w-full px-3 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  maxLength={128}
                  className="w-full px-3 py-2.5 pr-10 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Password strength indicator (signup only) */}
              {isSignUp && password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i < strengthScore ? strengthColor : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${
                    strengthScore <= 1 ? 'text-red-500' :
                    strengthScore <= 3 ? 'text-yellow-500' :
                    strengthScore <= 4 ? 'text-blue-500' : 'text-green-500'
                  }`}>
                    {strengthLabel}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {PASSWORD_RULES.map((rule, i) => (
                      <li key={i} className={`text-xs flex items-center gap-1 ${rule.test(password) ? 'text-green-500' : 'text-muted-foreground'}`}>
                        <span>{rule.test(password) ? '✓' : '○'}</span>
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Confirm Password (signup only) */}
            {isSignUp && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    maxLength={128}
                    className={`w-full px-3 py-2.5 pr-10 bg-background border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                      confirmPassword && confirmPassword !== password
                        ? 'border-red-500'
                        : confirmPassword && confirmPassword === password
                        ? 'border-green-500'
                        : 'border-input'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== password && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            {isSignUp && signupCooldownNotice && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
                <p className="text-sm text-amber-500">{signupCooldownNotice}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || isLocked}
              className="w-full py-2.5 bg-black text-green-400 rounded-lg text-sm font-semibold hover:bg-gray-900 transition-colors disabled:opacity-50 border border-green-400"
            >
              {isLocked
                ? `Locked (${lockoutCountdown}s)`
                : loading
                ? 'Please wait...'
                : isSignUp
                ? 'Create Account'
                : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setPassword('');
                  setConfirmPassword('');
                }}
                className="text-green-400 font-medium hover:underline"
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 mt-4 text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-xs">Secured with end-to-end encryption</span>
        </div>
      </div>
    </main>
  );
}
