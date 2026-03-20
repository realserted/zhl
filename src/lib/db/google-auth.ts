import { supabase } from '@/lib/supabase/client';
import type { GoogleTokenStatus } from '@/lib/types/files';

/** Get a valid Supabase access token, refreshing if necessary. */
async function getAccessToken(): Promise<string | null> {
  // Try cached session first
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.access_token) return sessionData.session.access_token;

  // Session might be stale after redirect — force a refresh
  const { data: refreshData } = await supabase.auth.refreshSession();
  return refreshData?.session?.access_token ?? null;
}

/** Check if the current user (or project owner) has a connected Google account. */
export async function getGoogleTokenStatus(projectId?: string | null): Promise<GoogleTokenStatus> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return { connected: false, google_email: null };

    const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`/api/auth/google/status${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return { connected: false, google_email: null };
    return await res.json();
  } catch {
    return { connected: false, google_email: null };
  }
}

/** Redirect the user to the Google OAuth consent screen. */
export function initiateGoogleAuth(returnUrl?: string): void {
  const url = returnUrl
    ? `/api/auth/google?returnUrl=${encodeURIComponent(returnUrl)}`
    : '/api/auth/google';
  window.location.href = url;
}

/** Disconnect Google account (revoke token and delete). */
export async function disconnectGoogle(): Promise<boolean> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return false;

    const res = await fetch('/api/auth/google/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Finalize Google auth when the callback couldn't identify the user from cookies.
 * Called when the URL has ?google_auth=finalize&data=...
 */
export async function finalizeGoogleAuth(encodedData: string): Promise<boolean> {
  try {
    // After OAuth redirect chain, session may need time to restore — retry once
    let accessToken = await getAccessToken();
    if (!accessToken) {
      // Wait a moment for auth state to settle after redirect
      await new Promise(resolve => setTimeout(resolve, 1000));
      accessToken = await getAccessToken();
    }
    if (!accessToken) return false;

    // Decode base64url in the browser (Buffer is not available client-side)
    const base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64));

    const res = await fetch('/api/auth/google/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(decoded),
    });

    return res.ok;
  } catch {
    return false;
  }
}
