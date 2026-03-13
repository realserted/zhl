'use client';

import { ProjectPermission } from '@/lib/types/project';

type PermField = keyof Pick<
  ProjectPermission,
  'perm_taskers' | 'perm_unit_data' | 'perm_files' | 'perm_accounts' |
  'perm_reports' | 'perm_templates' | 'perm_meetings' | 'perm_user_logs'
>;

/**
 * Derives canEdit / canAdmin from a permission record and field name.
 *
 * Replaces the repeated pattern:
 *   const permLevel = userPermission?.perm_xxx ?? 'Admin';
 *   const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;
 */
export function usePermission(
  userPermission: ProjectPermission | null | undefined,
  field: PermField,
  isAdmin?: boolean
) {
  const permLevel = userPermission?.[field] ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission || !!isAdmin;
  const canAdmin = permLevel === 'Admin' || !userPermission || !!isAdmin;
  return { permLevel, canEdit, canAdmin };
}
