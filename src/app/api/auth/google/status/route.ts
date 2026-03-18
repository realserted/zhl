import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

/**
 * GET /api/auth/google/status
 * Returns whether the current user has a connected Google account.
 */
export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check the user's own token first
  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('google_email')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (tokenRow) {
    return NextResponse.json({
      connected: true,
      google_email: tokenRow.google_email || null,
    });
  }

  // If the user doesn't have their own token, check if the project owner has one
  // This allows project members to access Drive via the owner's connection
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (projectId) {
    const { data: project } = await adminClient
      .from('zhl_projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle();

    if (project?.owner_id) {
      const { data: ownerToken } = await adminClient
        .from('zhl_google_tokens')
        .select('google_email')
        .eq('user_id', project.owner_id)
        .maybeSingle();

      if (ownerToken) {
        return NextResponse.json({
          connected: true,
          google_email: ownerToken.google_email || null,
          via_owner: true,
        });
      }
    }
  }

  return NextResponse.json({
    connected: false,
    google_email: null,
  });
}
