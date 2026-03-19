'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import Link from 'next/link';
import { Eye, EyeOff, ShieldCheck, Mail, Building2 } from 'lucide-react';

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

interface LoginPageProps {
  initialMode?: 'login' | 'signup';
}

export default function LoginPage({ initialMode = 'login' }: LoginPageProps) {
  const { signIn, signUp, resendVerification } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const isSignUp = initialMode === 'signup';
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
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutCountdown, setLockoutCountdown] = useState(0);
  const [signUpCooldownUntil, setSignUpCooldownUntil] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (signUpTimerRef.current) clearInterval(signUpTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lockoutUntil) {
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
  const strengthScore = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const strengthLabel = strengthScore <= 1 ? 'Weak' : strengthScore <= 3 ? 'Fair' : strengthScore <= 4 ? 'Good' : 'Strong';
  const strengthColor = strengthScore <= 1 ? 'bg-red-500' : strengthScore <= 3 ? 'bg-yellow-500' : strengthScore <= 4 ? 'bg-blue-500' : 'bg-green-500';

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isSignUp && isLocked) {
      setError(`Too many failed attempts. Try again in ${lockoutCountdown} seconds.`);
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();

    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (isSignUp) {
      if (!trimmedName) { setError('Display name is required.'); return; }
      if (trimmedName.length < 2) { setError('Display name must be at least 2 characters.'); return; }

      const failedRules = PASSWORD_RULES.filter((r) => !r.test(password));
      if (failedRules.length > 0) {
        setError(`Password requirements not met: ${failedRules.map((r) => r.label.toLowerCase()).join(', ')}.`);
        return;
      }

      if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

      setLoading(true);
      const { error } = await signUp(trimmedEmail, password, trimmedName, phone.trim());
      if (error) {
        const normalized = error.toLowerCase();
        if (normalized.includes('email rate limit exceeded') || normalized.includes('security purposes')) {
          setSignUpCooldownUntil(Date.now() + SIGNUP_COOLDOWN_SECONDS * 1000);
          setError(null);
          setSignupCooldownNotice('Email sending is rate limited. Please wait a few minutes and try again.');
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

  const isDark = resolvedTheme === 'dark';

  // ── Sign up success screen ──
  if (signUpSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Check your email</h2>
            <p className="text-muted-foreground text-sm mb-4">
              We sent a confirmation link to <strong>{email}</strong>. Please verify your email to continue.
            </p>
            <div className="mb-6">
              {resendStatus === 'sent' ? (
                <p className="text-sm text-green-500 font-medium">Verification email resent!</p>
              ) : resendStatus === 'error' ? (
                <div>
                  <p className="text-sm text-red-500 mb-1">{resendError}</p>
                  <button onClick={() => setResendStatus('idle')} className="text-sm text-muted-foreground hover:underline">Try again</button>
                </div>
              ) : (
                <button
                  disabled={resendStatus === 'sending'}
                  onClick={async () => {
                    setResendStatus('sending');
                    const { error } = await resendVerification(email.trim().toLowerCase(), password);
                    if (error) { setResendError(error); setResendStatus('error'); }
                    else setResendStatus('sent');
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline font-medium inline-flex items-center gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {resendStatus === 'sending' ? 'Sending...' : "Didn't receive it? Resend"}
                </button>
              )}
            </div>
            <button
              onClick={() => { setSignUpSuccess(false); setEmail(''); setPassword(''); setConfirmPassword(''); setDisplayName(''); setPhone(''); setResendStatus('idle'); router.push('/login'); }}
              className="text-sm text-primary hover:underline font-medium"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Input class helper ──
  const inputClass = 'w-full px-4 py-2.5 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all';

  return (
    <main className="flex min-h-screen bg-background">
      {/* ── Left Panel (branding) — hidden on mobile ── */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-neutral-950 via-green-950 to-neutral-950 relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: isSignUp
              ? 'radial-gradient(ellipse 80% 80% at 80% 20%, hsl(145 50% 30% / 0.2), transparent)'
              : 'radial-gradient(ellipse 80% 80% at 20% 80%, hsl(145 50% 30% / 0.2), transparent)',
          }}
        />
        <div className="relative flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-green-400" />
            <span className="text-xl font-bold">
              <span className="text-white">Zero Hassle</span>{' '}
              <span className="text-green-400">Landlord</span>
            </span>
          </Link>

          {/* Quote */}
          <div>
            <blockquote className="text-2xl font-semibold text-white/90 leading-relaxed">
              {isSignUp
                ? '"Manage every property, every tenant, and every task — all from one dashboard."'
                : '"Finally, a property management tool that doesn\'t get in the way of actually managing properties."'}
            </blockquote>
            <p className="mt-4 text-sm text-green-300/70">
              {isSignUp
                ? 'Join property managers who switched to ZHL.'
                : '— What every landlord thinks'}
            </p>
          </div>

          {/* Trust line */}
          <div className="flex items-center gap-3 text-xs text-green-400/50">
            <span>{isSignUp ? 'Free to start' : 'Secure access'}</span>
            <span>&middot;</span>
            <span>{isSignUp ? 'No credit card required' : 'Files stay on Google Drive'}</span>
            <span>&middot;</span>
            <span>{isSignUp ? 'Set up in minutes' : 'Cancel anytime'}</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel (form) ── */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            {mounted && (
              <Link href="/">
                <Image
                  src={isDark ? '/zhl-logo-light.png' : '/zhl-logo-dark.png'}
                  alt="Zero Hassle Landlord"
                  width={200}
                  height={80}
                  priority
                  className="h-16 w-auto mx-auto"
                />
              </Link>
            )}
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isSignUp ? 'Start managing your properties today.' : 'Sign in to manage your properties.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {isSignUp && (
              <>
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">Display Name</label>
                  <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="John Doe" required maxLength={100} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1.5">
                    Phone Number <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" maxLength={20} className={inputClass} />
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required maxLength={255} className={inputClass} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
                {!isSignUp && (
                  <button type="button" onClick={() => router.push('/forgot-password')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required maxLength={128} className={`${inputClass} pr-10`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {isSignUp && password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < strengthScore ? strengthColor : 'bg-muted'}`} />
                    ))}
                  </div>
                  <p className={`text-xs ${strengthScore <= 1 ? 'text-red-500' : strengthScore <= 3 ? 'text-yellow-500' : strengthScore <= 4 ? 'text-blue-500' : 'text-green-500'}`}>
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

            {isSignUp && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">Confirm password</label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    maxLength={128}
                    className={`${inputClass} pr-10 ${
                      confirmPassword && confirmPassword !== password ? 'border-red-500' :
                      confirmPassword && confirmPassword === password ? 'border-green-500' : ''
                    }`}
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
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
              className="w-full h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-50"
            >
              {isLocked ? `Locked (${lockoutCountdown}s)` : loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {/* Toggle link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => { setError(null); setPassword(''); setConfirmPassword(''); router.push(isSignUp ? '/login' : '/signup'); }}
                className="text-primary font-medium hover:underline"
              >
                {isSignUp ? 'Sign in' : 'Create account'}
              </button>
            </p>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-muted-foreground">
            By {isSignUp ? 'creating an account' : 'signing in'}, you agree to our{' '}
            <a href="#" className="underline underline-offset-2 hover:text-foreground transition-colors">Terms of Service</a>
            {' '}and{' '}
            <a href="#" className="underline underline-offset-2 hover:text-foreground transition-colors">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
