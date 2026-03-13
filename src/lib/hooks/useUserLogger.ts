'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { logUserAction } from '@/lib/db/user-logs';

/**
 * Hook that resolves the current user's display name and email once,
 * then provides a stable `log(action)` function for user-action logging.
 *
 * Returns:
 *   - log(action): stable callback for logging user actions
 *   - displayName: ref for use in async callbacks (avoids stale closures)
 *   - displayNameValue: reactive state for use in JSX/memos
 *   - userEmail: ref for use in async callbacks
 */
export function useUserLogger(projectId: string | null) {
  const { user } = useAuth();
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');
  const [displayNameValue, setDisplayNameValue] = useState('');

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('zhl_accounts')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = data?.display_name || user.email || 'Unknown';
        displayNameRef.current = name;
        setDisplayNameValue(name);
      });
  }, [user]);

  const log = useCallback(
    (action: string) => {
      if (!projectId || !user) return;
      logUserAction({
        projectId,
        userId: user.id,
        userName: displayNameRef.current,
        userEmail: userEmailRef.current,
        action,
      });
    },
    [projectId, user]
  );

  return { log, displayName: displayNameRef, displayNameValue, userEmail: userEmailRef };
}
