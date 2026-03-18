import { supabase } from '@/lib/supabase/client';
import type { GoogleTokenStatus } from '@/lib/types/files';

/** Check if the current user (or project owner) has a connected Google account. */
export async function getGoogleTokenStatus(projectId?: string | null): Promise<GoogleTokenStatus> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
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
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
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
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
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
