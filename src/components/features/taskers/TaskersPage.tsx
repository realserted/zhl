'use client';

import {
  Plus,
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  HelpCircle,
  X,
  Send,
  Loader2,
  Trash2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Tasker, TaskerLog } from '@/lib/types/tasker';
import {
  getTaskers,
  createTasker,
  updateTasker,
  deleteTasker,
  getTaskerLogs,
  addTaskerLog,
} from '@/lib/db/taskers';
import { logUserAction } from '@/lib/db/user-logs';
import { createNotification } from '@/lib/db/notifications';
import { ProjectPermission } from '@/lib/types/project';
import { getProjectSettings } from '@/lib/db/project-settings';

const STATUS_OPTIONS = ['Open', 'In Progress', 'Complete', 'Archived'] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  Complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Archived: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
  5: 'Critical',
};

interface TaskersPageProps {
  selectedProjectId: string | null;
  selectedProjectName?: string | null;
  userPermission?: ProjectPermission | null; // null = owner (full access)
}

export default function TaskersPage({ selectedProjectId, selectedProjectName, userPermission }: TaskersPageProps) {
  const { user } = useAuth();
  const [viewFilter, setViewFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [taskers, setTaskers] = useState<Tasker[]>([]);
  const [loading, setLoading] = useState(false);

  // Project users for dropdowns
  const [projectUsers, setProjectUsers] = useState<{ user_id: string | null; user_name: string }[]>([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTasker, setNewTasker] = useState({
    task_name: '',
    description: '',
    status: 'Open' as Tasker['status'],
    responsible_name: '',
    cc_name: '',
    got_the_ball_name: '',
    due_date: '',
    priority: 0,
    issues: '',
  });

  // Description modal
  const [descriptionModal, setDescriptionModal] = useState<Tasker | null>(null);

  // Log modal
  const [logModal, setLogModal] = useState<Tasker | null>(null);
  const [logs, setLogs] = useState<TaskerLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Help modal
  const [helpModal, setHelpModal] = useState<Tasker | null>(null);
  const [helpUser, setHelpUser] = useState('');

  // AI prompt state
  const [taskerNamePrompt, setTaskerNamePrompt] = useState('');
  const [statusPrompt, setStatusPrompt] = useState('');
  const [generatingName, setGeneratingName] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState(false);

  // Task name length validation
  const TASK_NAME_MAX = 30;
  const [taskNameSuggestion, setTaskNameSuggestion] = useState('');
  const [suggestingName, setSuggestingName] = useState(false);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const taskNameTooLong = newTasker.task_name.length > TASK_NAME_MAX;

  // Auto-suggest improvements (shorten if too long, fix spelling) after debounce
  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    const name = newTasker.task_name.trim();
    if (name.length < 3) {
      setTaskNameSuggestion('');
      return;
    }
    suggestTimerRef.current = setTimeout(async () => {
      setSuggestingName(true);
      try {
        const instructions = taskNameTooLong
          ? `This task name is too long (max ${TASK_NAME_MAX} chars). Shorten it to under ${TASK_NAME_MAX} characters while keeping its meaning. Also fix any spelling or grammar errors. Return ONLY the corrected/shortened name, nothing else.`
          : `Check this task name for spelling or grammar errors. If there are errors, return the corrected version. If the name is already correct, return exactly "OK". Return ONLY the corrected name or "OK", nothing else.`;
        const res = await fetch('/api/ai/generate-tasker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'task_name',
            prompt: instructions,
            context: name,
          }),
        });
        const data = await res.json();
        const result = data.result?.trim();
        // Only show suggestion if AI returned something different from the input
        if (result && result !== 'OK' && result.toLowerCase() !== name.toLowerCase()) {
          setTaskNameSuggestion(result);
        } else {
          setTaskNameSuggestion('');
        }
      } catch { /* ignore */ }
      setSuggestingName(false);
    }, 800);
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current); };
  }, [newTasker.task_name, taskNameTooLong]);

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // Load project users
  useEffect(() => {
    if (!selectedProjectId) return;
    supabase
      .from('zhl_project_permissions')
      .select('user_id, user_name')
      .eq('project_id', selectedProjectId)
      .then(({ data }) => {
        setProjectUsers(data ?? []);
      });
  }, [selectedProjectId]);

  // Load taskers when project changes
  useEffect(() => {
    if (!selectedProjectId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getTaskers(selectedProjectId).then((data) => {
      setTaskers(data);
      setLoading(false);
    });
  }, [selectedProjectId]);

  // Load AI prompts for this project
  useEffect(() => {
    if (!selectedProjectId) return;
    getProjectSettings(selectedProjectId).then((settings) => {
      setTaskerNamePrompt(settings.tasker_name_ai_prompt || '');
      setStatusPrompt(settings.status_ai_prompt || '');
    });
  }, [selectedProjectId]);

  const handleGenerateTaskName = async () => {
    if (!taskerNamePrompt) return;
    setGeneratingName(true);
    try {
      const res = await fetch('/api/ai/generate-tasker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'task_name',
          prompt: taskerNamePrompt,
          context: selectedProjectName ? `Project: ${selectedProjectName}` : undefined,
        }),
      });
      const data = await res.json();
      if (data.result) setNewTasker((prev) => ({ ...prev, task_name: data.result }));
    } catch (err) {
      console.error('Error generating task name:', err);
    }
    setGeneratingName(false);
  };

  const handleGenerateStatus = async (taskName: string, currentStatus: string) => {
    if (!statusPrompt) return '';
    setGeneratingStatus(true);
    try {
      const res = await fetch('/api/ai/generate-tasker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'status',
          prompt: statusPrompt,
          context: `Task: ${taskName}\nCurrent status: ${currentStatus}`,
        }),
      });
      const data = await res.json();
      setGeneratingStatus(false);
      return data.result || '';
    } catch (err) {
      console.error('Error generating status:', err);
      setGeneratingStatus(false);
      return '';
    }
  };

  // Get current user display name and email — use refs to avoid stale closures
  const [displayName, setDisplayName] = useState('');
  const [, setUserEmail] = useState('');
  const displayNameRef = useRef('');
  const userEmailRef = useRef('');
  useEffect(() => {
    if (!user) return;
    supabase
      .from('zhl_accounts')
      .select('display_name, email')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        const name = data?.display_name || user.user_metadata?.display_name || user.email || 'Unknown';
        const email = data?.email || user.email || '';
        setDisplayName(name);
        setUserEmail(email);
        displayNameRef.current = name;
        userEmailRef.current = email;
      });
  }, [user]);

  const projectUserOptions = useMemo(() => {
    const seen = new Set<string>();
    const unique: { user_id: string | null; user_name: string }[] = [];

    for (const u of projectUsers) {
      const name = (u.user_name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ user_id: u.user_id, user_name: name });
    }

    const currentName = displayName.trim();
    if (currentName && !seen.has(currentName.toLowerCase())) {
      unique.push({ user_id: user?.id ?? null, user_name: currentName });
    }

    unique.sort((a, b) => a.user_name.localeCompare(b.user_name));
    return unique;
  }, [projectUsers, displayName, user?.id]);

  const findProjectUserByName = (name: string) =>
    projectUserOptions.find((u) => u.user_name.trim().toLowerCase() === name.trim().toLowerCase());

  // Permission flags — null userPermission means owner (full access)
  const permLevel = userPermission?.perm_taskers ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;
  const isViewOnly = permLevel === 'View' && !!userPermission;

  // Check if the current user is assigned to a task (responsible, cc, got the ball, or help)
  const isAssignedTo = (t: Tasker) =>
    t.responsible === user?.id ||
    t.cc === user?.id ||
    t.got_the_ball === user?.id ||
    t.help_request_user === user?.id ||
    t.responsible_name === displayName ||
    t.cc_name === displayName ||
    t.got_the_ball_name === displayName ||
    t.help_request_user_name === displayName;

  // Filter taskers — View-only users only see tasks assigned to them
  const filteredTaskers = taskers.filter((t) => {
    // View-only users always limited to assigned tasks
    if (isViewOnly && !isAssignedTo(t)) return false;

    if (viewFilter === 'all') return true;
    if (viewFilter === 'relevant') return isAssignedTo(t);
    if (viewFilter === 'pm') {
      return t.responsible === user?.id || t.responsible_name === displayName;
    }
    return true;
  });

  // Create tasker handler
  const handleCreate = async () => {
    if (!user || !selectedProjectId || !newTasker.task_name.trim()) return;
    setCreating(true);

    const responsibleName = newTasker.responsible_name || displayName;
    const ccName = newTasker.cc_name || null;
    const gotTheBallName = newTasker.got_the_ball_name || null;

    const responsibleUser = responsibleName ? findProjectUserByName(responsibleName) : null;
    const ccUser = ccName ? findProjectUserByName(ccName) : null;
    const gotTheBallUser = gotTheBallName ? findProjectUserByName(gotTheBallName) : null;

    const tasker = await createTasker({
      project_id: selectedProjectId,
      status: newTasker.status,
      task_name: newTasker.task_name.trim(),
      description: newTasker.description.trim() || null,
      update_status: null,
      responsible: responsibleUser?.user_id ?? null,
      responsible_name: responsibleName,
      cc: ccUser?.user_id ?? null,
      cc_name: ccName,
      got_the_ball: gotTheBallUser?.user_id ?? null,
      got_the_ball_name: gotTheBallName,
      priority: newTasker.priority,
      due_date: newTasker.due_date || null,
      original_due_date: newTasker.due_date || null,
      help_request_user: null,
      help_request_user_name: null,
      issues: newTasker.issues.trim() || null,
      created_by: user.id,
    });

    if (tasker) {
      setTaskers((prev) => [tasker, ...prev]);
      // Auto-grant access for assigned users
      const assignedNames = [
        newTasker.responsible_name,
        newTasker.cc_name,
        newTasker.got_the_ball_name,
      ].filter(Boolean) as string[];
      await Promise.all(assignedNames.map((name) => ensureUserHasProjectAccess(name)));

      // Notify assigned users (fire-and-forget)
      const roleLabel = { responsible: 'Responsible', cc: 'CC', got_the_ball: 'Got the Ball' } as const;
      const assignees: { userId: string | null; role: keyof typeof roleLabel }[] = [
        { userId: responsibleUser?.user_id ?? null, role: 'responsible' },
        { userId: ccUser?.user_id ?? null, role: 'cc' },
        { userId: gotTheBallUser?.user_id ?? null, role: 'got_the_ball' },
      ];
      for (const a of assignees) {
        if (a.userId && a.userId !== user.id) {
          createNotification({
            userId: a.userId,
            type: 'tasker_assignment',
            title: 'New Tasker Assignment',
            message: `You were assigned as ${roleLabel[a.role]} on "${tasker.task_name}"${selectedProjectName ? ` in project "${selectedProjectName}"` : ''} by ${displayName}`,
            relatedId: tasker.id,
            relatedType: 'tasker',
          }).catch(() => {});
        }
      }

      await addTaskerLog({
        tasker_id: tasker.id,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Created tasker "${tasker.task_name}"`,
      });
      logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Created tasker "${tasker.task_name}"` });
      setNewTasker({
        task_name: '',
        description: '',
        status: 'Open',
        responsible_name: '',
        cc_name: '',
        got_the_ball_name: '',
        due_date: '',
        priority: 0,
        issues: '',
      });
      setShowCreate(false);
    }
    setCreating(false);
  };

  const handleRoleUpdate = async (
    tasker: Tasker,
    role: 'responsible' | 'cc' | 'got_the_ball',
    selectedName: string
  ) => {
    const selectedUser = selectedName ? findProjectUserByName(selectedName) : undefined;
    const updates: Partial<Tasker> =
      role === 'responsible'
        ? { responsible_name: selectedName || null, responsible: selectedUser?.user_id ?? null }
        : role === 'cc'
          ? { cc_name: selectedName || null, cc: selectedUser?.user_id ?? null }
          : { got_the_ball_name: selectedName || null, got_the_ball: selectedUser?.user_id ?? null };

    const ok = await updateTasker(tasker.id, updates);
    if (!ok) return;

    const prevName = role === 'responsible'
      ? tasker.responsible_name
      : role === 'cc'
        ? tasker.cc_name
        : tasker.got_the_ball_name;
    setTaskers((prev) => prev.map((t) => (t.id === tasker.id ? { ...t, ...updates } : t)));
    if (selectedName) {
      await ensureUserHasProjectAccess(selectedName);
    }

    const roleLabel = { responsible: 'Responsible', cc: 'CC', got_the_ball: 'Got the Ball' } as const;
    if (user) {
      await addTaskerLog({
        tasker_id: tasker.id,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Changed ${roleLabel[role]} from "${prevName ?? ''}" to "${selectedName || ''}"`,
      });
    }
    if (selectedProjectId && user) {
      logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Updated tasker "${tasker.task_name}" — changed ${roleLabel[role]}` });
    }

    // Notify newly assigned user
    if (selectedUser?.user_id && selectedUser.user_id !== user?.id) {
      createNotification({
        userId: selectedUser.user_id,
        type: 'tasker_assignment',
        title: 'Tasker Assignment Updated',
        message: `You were assigned as ${roleLabel[role]} on "${tasker.task_name}"${selectedProjectName ? ` in project "${selectedProjectName}"` : ''} by ${displayName}`,
        relatedId: tasker.id,
        relatedType: 'tasker',
      }).catch(() => {});
    }
  };

  // Auto-grant project access when a user is assigned to a tasker
  const ensureUserHasProjectAccess = async (assignedName: string) => {
    if (!selectedProjectId || !assignedName.trim()) return;
    // Check if already a member by name
    const { data: existing } = await supabase
      .from('zhl_project_permissions')
      .select('id')
      .eq('project_id', selectedProjectId)
      .ilike('user_name', assignedName.trim())
      .maybeSingle();
    if (existing) return; // already has access
    // Look up their account via SECURITY DEFINER function (bypasses accounts RLS)
    const { data: accounts } = await supabase.rpc('lookup_account_by_name', { p_name: assignedName.trim() });
    const account = Array.isArray(accounts) ? accounts[0] : null;
    const userName = account?.display_name ?? assignedName.trim();
    const accountEmail = account?.email ?? '';
    const accountUserId = account?.user_id ?? null;
    // Add with view-level permissions (include user_id so they can see the project immediately)
    await supabase.from('zhl_project_permissions').insert({
      project_id: selectedProjectId,
      user_id: accountUserId,
      user_name: userName,
      user_email: accountEmail,
      perm_taskers: 'View',
      perm_unit_data: 'View',
      perm_files: 'View',
      perm_accounts: 'View',
      perm_reports: 'View',
      perm_templates: 'View Only',
      perm_meetings: 'View',
      perm_user_logs: "View / Don't view",
      project_role: 'Project Manager (can change all permissions on a project)',
      work_role: 'Administrative',
    });
    // Refresh project users list
    const { data: updatedUsers } = await supabase
      .from('zhl_project_permissions')
      .select('user_id, user_name')
      .eq('project_id', selectedProjectId);
    setProjectUsers(updatedUsers ?? []);
  };

  // Inline field save
  const saveInlineEdit = async (taskerId: string, field: string, value: string) => {
    const tasker = taskers.find((t) => t.id === taskerId);
    if (!tasker || !user) return;

    // Block saving task names that are too long
    if (field === 'task_name' && value.length > TASK_NAME_MAX) {
      setEditingCell(null);
      return;
    }

    const oldValue = (tasker as unknown as Record<string, unknown>)[field];
    if (oldValue === value) {
      setEditingCell(null);
      return;
    }

    const ok = await updateTasker(taskerId, { [field]: value || null });
    if (ok) {
      setTaskers((prev) =>
        prev.map((t) => (t.id === taskerId ? { ...t, [field]: value || null } : t))
      );
      // Auto-grant access when assigning someone to a role
      if (['responsible_name', 'cc_name', 'got_the_ball_name'].includes(field) && value) {
        await ensureUserHasProjectAccess(value);
      }
      const fieldLabel = field.replace(/_/g, ' ');
      await addTaskerLog({
        tasker_id: taskerId,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Changed ${fieldLabel} from "${oldValue ?? ''}" to "${value}"`,
      });
      if (selectedProjectId) {
        logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Updated tasker "${tasker.task_name}" — changed ${fieldLabel}` });
      }
    }
    setEditingCell(null);
  };

  // Open log modal
  const openLogModal = async (tasker: Tasker) => {
    setLogModal(tasker);
    setLoadingLogs(true);
    const data = await getTaskerLogs(tasker.id);
    setLogs(data);
    setLoadingLogs(false);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // Send chat message
  const handleSendMessage = async () => {
    if (!logModal || !user || !newMessage.trim()) return;
    setSendingMessage(true);
    const log = await addTaskerLog({
      tasker_id: logModal.id,
      user_id: user.id,
      user_name: displayName,
      type: 'comment',
      message: newMessage.trim(),
    });
    if (log) {
      setLogs((prev) => [...prev, log]);
      setNewMessage('');
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
    setSendingMessage(false);
  };

  // Help request
  const handleHelpRequest = async () => {
    if (!helpModal || !user || !helpUser.trim()) return;
    const ok = await updateTasker(helpModal.id, { help_request_user_name: helpUser.trim() });
    if (ok) {
      setTaskers((prev) =>
        prev.map((t) =>
          t.id === helpModal.id ? { ...t, help_request_user_name: helpUser.trim() } : t
        )
      );
      await addTaskerLog({
        tasker_id: helpModal.id,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Requested help from "${helpUser.trim()}"`,
      });
      if (selectedProjectId) {
        logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Requested help from "${helpUser.trim()}" for tasker "${helpModal.task_name}"` });
      }
    }
    setHelpModal(null);
    setHelpUser('');
  };

  // Delete tasker
  const handleDelete = async (taskerId: string) => {
    const tasker = taskers.find((t) => t.id === taskerId);
    const ok = await deleteTasker(taskerId);
    if (ok) {
      setTaskers((prev) => prev.filter((t) => t.id !== taskerId));
      if (user && selectedProjectId && tasker) {
        logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Deleted tasker "${tasker.task_name}"` });
      }
    }
  };

  // Editable cell component
  const EditableCell = ({
    tasker,
    field,
    displayValue,
    type = 'text',
  }: {
    tasker: Tasker;
    field: string;
    displayValue: string;
    type?: string;
  }) => {
    const isEditing = editingCell?.id === tasker.id && editingCell?.field === field;
    // Assigned users can edit update_status even with View-only permission
    const canEditThis = canEdit || (field === 'update_status' && isAssignedTo(tasker));

    if (isEditing) {
      return (
        <input
          autoFocus
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => saveInlineEdit(tasker.id, field, editValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveInlineEdit(tasker.id, field, editValue);
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
    }

    if (!canEditThis) {
      return (
        <span className="px-1 py-0.5 block min-w-8 min-h-5">
          {displayValue || <span className="text-muted-foreground/40">-</span>}
        </span>
      );
    }

    return (
      <span
        onClick={() => {
          setEditingCell({ id: tasker.id, field });
          setEditValue(displayValue);
        }}
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded block min-w-8 min-h-5"
        title="Click to edit"
      >
        {displayValue || <span className="text-muted-foreground/40">-</span>}
      </span>
    );
  };

  const selectClass = 'bg-muted/50 border border-border/50 rounded-lg px-2 py-1 text-[11px] font-bold transition-all focus:ring-2 focus:ring-primary/20 outline-none';
  const inputClass =
    'w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-xl text-sm font-medium transition-all focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50';

  return (
    <main className="bg-muted/30 dark:bg-background/50 p-4 sm:p-8">
      <div className="max-w-[1400px] mx-auto">
        {/* Title Area */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Your Taskers</h1>
            <p className="text-muted-foreground text-sm font-medium">
              Manage and track all property-related tasks and responsibilities.
            </p>
          </div>
        </div>

        {/* View Taskers and Create Section */}
        <div className="glass-card rounded-2xl p-4 mb-8 flex flex-col lg:flex-row lg:items-center gap-6 shadow-sm border border-border/50">
          {/* View Taskers Filter */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">View:</span>
            <div className="flex bg-muted/50 p-1 rounded-xl border border-input">
              {[
                { key: 'all', label: 'All Taskers' },
                { key: 'relevant', label: 'Only Relevant' },
                { key: 'pm', label: 'Only PM' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setViewFilter(f.key)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    viewFilter === f.key 
                      ? 'bg-background text-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-4 w-px bg-border hidden lg:block" />

          {/* Create Tasker Button */}
          {canEdit && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95 group"
            >
              <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
              CREATE TASKER
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="lg:ml-auto flex bg-muted/50 p-1 rounded-xl border border-input">
            <button
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'table' 
                  ? 'bg-background text-foreground shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Table view"
            >
              <List className="h-4 w-4" />
              <span>TABLE</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'calendar' 
                  ? 'bg-background text-foreground shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Calendar view"
            >
              <Calendar className="h-4 w-4" />
              <span>CALENDAR</span>
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading taskers...
          </div>
        ) : !selectedProjectId ? (
          <p className="text-sm text-muted-foreground py-8">No project selected. Create a project in Settings first.</p>
        ) : viewMode === 'calendar' ? (
          /* ===== CALENDAR VIEW ===== */
          (() => {
            const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const { year, month } = calendarDate;
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

            // Build calendar grid: leading prev-month days + current month + trailing next-month days
            const firstDayOfWeek = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const daysInPrevMonth = new Date(year, month, 0).getDate();
            const cells: { dateStr: string; day: number; inMonth: boolean }[] = [];
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
              const d = daysInPrevMonth - i;
              const m = month === 0 ? 12 : month;
              const y = month === 0 ? year - 1 : year;
              cells.push({ dateStr: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: false });
            }
            for (let d = 1; d <= daysInMonth; d++) {
              cells.push({ dateStr: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: true });
            }
            const remaining = 42 - cells.length;
            for (let d = 1; d <= remaining; d++) {
              const m = month === 11 ? 1 : month + 2;
              const y = month === 11 ? year + 1 : year;
              cells.push({ dateStr: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: false });
            }

            const taskersForDate = (dateStr: string) => filteredTaskers.filter(t => t.due_date === dateStr);

            return (
              <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm flex flex-col">
                {/* Calendar header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-background/50 backdrop-blur-sm">
                  <button
                    onClick={() => setCalendarDate(d => d.month === 0 ? { year: d.year - 1, month: 11 } : { year: d.year, month: d.month - 1 })}
                    className="p-2 rounded-xl hover:bg-muted transition-all active:scale-95 border border-border/50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-lg tracking-tight">{MONTH_NAMES[month]} {year}</span>
                    <button
                      onClick={() => { const n = new Date(); setCalendarDate({ year: n.getFullYear(), month: n.getMonth() }); }}
                      className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-muted/50 border border-border/50 rounded-lg hover:bg-muted transition-all"
                    >
                      Today
                    </button>
                  </div>
                  <button
                    onClick={() => setCalendarDate(d => d.month === 11 ? { year: d.year + 1, month: 0 } : { year: d.year, month: d.month + 1 })}
                    className="p-2 rounded-xl hover:bg-muted transition-all active:scale-95 border border-border/50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Day-of-week header */}
                <div className="grid grid-cols-7 border-b border-border/50 bg-muted/30">
                  {DAY_NAMES.map(d => (
                    <div key={d} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-r border-border/50 last:border-r-0">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7">
                  {cells.map((cell, idx) => {
                    const dayTaskers = taskersForDate(cell.dateStr);
                    const isToday = cell.dateStr === todayStr;
                    return (
                      <div
                        key={idx}
                        className={`min-h-[120px] p-2 border-r border-b border-border/50 last:border-r-0 transition-colors group hover:bg-muted/20 ${!cell.inMonth ? 'bg-muted/10 opacity-60' : 'bg-transparent'}`}
                      >
                        {/* Day number */}
                        <div className={`text-xs font-bold mb-2 w-7 h-7 flex items-center justify-center rounded-xl transition-all ${
                          isToday 
                            ? 'bg-primary text-primary-foreground shadow-md scale-110' 
                            : cell.inMonth 
                              ? 'text-foreground group-hover:bg-muted/50' 
                              : 'text-muted-foreground/30'
                        }`}>
                          {cell.day}
                        </div>
                        {/* Tasker chips */}
                        <div className="flex flex-col gap-1">
                          {dayTaskers.map(t => (
                            <button
                              key={t.id}
                              onClick={() => openLogModal(t)}
                              title={`${t.task_name}${t.responsible_name ? ` — ${t.responsible_name}` : ''}`}
                              className={`w-full text-left px-2 py-1 rounded-lg text-[9px] font-bold truncate leading-tight transition-all border border-transparent hover:border-border/50 shadow-sm ${STATUS_COLORS[t.status]} hover:opacity-90 active:scale-[0.98]`}
                            >
                              {t.priority > 0 && <span className="opacity-70 mr-1">[{PRIORITY_LABELS[t.priority]}]</span>}
                              {t.task_name}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-4 px-6 py-4 border-t border-border/50 bg-muted/30">
                  {Object.entries(STATUS_COLORS).map(([status, cls]) => (
                    <span key={status} className={`inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-border/50 shadow-sm ${cls}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                      {status}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()
        ) : (
          /* Taskers Table */
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Task Name</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Description</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Update Status</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Responsible</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">CC</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">&quot;Got the Ball&quot;</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Priority</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Due</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Log</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Help</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Issues</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Original due vs now</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {filteredTaskers.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-muted-foreground">
                      No taskers yet. Click &quot;Create tasker&quot; to add one.
                    </td>
                  </tr>
                ) : (
                  filteredTaskers.map((tasker) => (
                    <tr
                      key={tasker.id}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
                    >
                      {/* Status dropdown */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <select
                          disabled={!canEdit}
                          className={`${selectClass} ${STATUS_COLORS[tasker.status] || ''} ${!canEdit ? 'opacity-75 cursor-default' : ''} border-none shadow-sm shadow-black/5`}
                          value={tasker.status}
                          onChange={async (e) => {
                            const newStatus = e.target.value as Tasker['status'];
                            const ok = await updateTasker(tasker.id, { status: newStatus });
                            if (ok) {
                              setTaskers((prev) =>
                                prev.map((t) =>
                                  t.id === tasker.id ? { ...t, status: newStatus } : t
                                )
                              );
                              if (user) {
                                await addTaskerLog({
                                  tasker_id: tasker.id,
                                  user_id: user.id,
                                  user_name: displayName,
                                  type: 'change',
                                  message: `Changed status from "${tasker.status}" to "${newStatus}"`,
                                });
                                if (selectedProjectId) {
                                  logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Changed tasker "${tasker.task_name}" status to "${newStatus}"` });
                                }
                              }
                            }
                          }}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Task Name */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="font-bold text-sm tracking-tight">
                          <EditableCell
                            tasker={tasker}
                            field="task_name"
                            displayValue={tasker.task_name}
                          />
                        </div>
                      </td>

                      {/* Description - clickable link to open modal */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => setDescriptionModal(tasker)}
                          className="text-primary hover:underline text-xs font-bold leading-none max-w-[150px] truncate block"
                          title={tasker.description || 'Add description'}
                        >
                          {tasker.description
                            ? tasker.description.length > 30
                              ? tasker.description.slice(0, 30) + '...'
                              : tasker.description
                            : '+ Description'}
                        </button>
                      </td>

                      {/* Update Status (2nd status - user comments) */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 italic text-xs font-medium text-muted-foreground min-w-[120px]">
                            <EditableCell
                              tasker={tasker}
                              field="update_status"
                              displayValue={tasker.update_status ?? ''}
                            />
                          </div>
                          {statusPrompt && canEdit && (
                            <button
                              onClick={async () => {
                                const result = await handleGenerateStatus(tasker.task_name, tasker.update_status ?? '');
                                if (result) {
                                  await saveInlineEdit(tasker.id, 'update_status', result);
                                  setTaskers((prev) => prev.map((t) => t.id === tasker.id ? { ...t, update_status: result } : t));
                                }
                              }}
                              disabled={generatingStatus}
                              title="Generate status with AI"
                              className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-50 shrink-0 border border-border/50"
                            >
                              <Sparkles className="h-3 w-3 text-accent" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Responsible */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {canEdit ? (
                          <select
                            value={tasker.responsible_name ?? ''}
                            onChange={(e) => handleRoleUpdate(tasker, 'responsible', e.target.value)}
                            className={selectClass}
                          >
                            <option value="">-</option>
                            {projectUserOptions.map((u) => (
                              <option key={`responsible-${u.user_name}`} value={u.user_name}>
                                {u.user_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-2 py-1 block text-xs font-bold text-muted-foreground bg-muted/30 rounded-lg min-w-8">
                            {tasker.responsible_name || '-'}
                          </span>
                        )}
                      </td>

                      {/* CC */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {canEdit ? (
                          <select
                            value={tasker.cc_name ?? ''}
                            onChange={(e) => handleRoleUpdate(tasker, 'cc', e.target.value)}
                            className={selectClass}
                          >
                            <option value="">-</option>
                            {projectUserOptions.map((u) => (
                              <option key={`cc-${u.user_name}`} value={u.user_name}>
                                {u.user_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-2 py-1 block text-xs font-bold text-muted-foreground bg-muted/30 rounded-lg min-w-8">
                            {tasker.cc_name || '-'}
                          </span>
                        )}
                      </td>

                      {/* Got the Ball */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {canEdit ? (
                          <select
                            value={tasker.got_the_ball_name ?? ''}
                            onChange={(e) => handleRoleUpdate(tasker, 'got_the_ball', e.target.value)}
                            className={selectClass}
                          >
                            <option value="">-</option>
                            {projectUserOptions.map((u) => (
                              <option key={`gtb-${u.user_name}`} value={u.user_name}>
                                {u.user_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-2 py-1 block text-xs font-bold text-muted-foreground bg-muted/30 rounded-lg min-w-8">
                            {tasker.got_the_ball_name || '-'}
                          </span>
                        )}
                      </td>


                      {/* Priority */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <select
                          className={`${selectClass} min-w-[100px] border-none shadow-sm shadow-black/5`}
                          value={tasker.priority}
                          onChange={async (e) => {
                            const newPriority = parseInt(e.target.value);
                            const oldPriority = tasker.priority;
                            const ok = await updateTasker(tasker.id, { priority: newPriority });
                            if (ok) {
                              setTaskers((prev) =>
                                prev.map((t) =>
                                  t.id === tasker.id ? { ...t, priority: newPriority } : t
                                )
                              );
                              if (user) {
                                const priorityLabel = (p: number) => PRIORITY_LABELS[p] ?? 'None';
                                await addTaskerLog({
                                  tasker_id: tasker.id,
                                  user_id: user.id,
                                  user_name: displayName,
                                  type: 'change',
                                  message: `Changed Priority from "${priorityLabel(oldPriority)}" to "${priorityLabel(newPriority)}"`,
                                });
                                if (selectedProjectId) {
                                  logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Updated tasker "${tasker.task_name}" — changed Priority` });
                                }
                              }
                            }
                          }}
                        >
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {PRIORITY_LABELS[n]}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Due Date */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="date"
                          value={tasker.due_date ?? ''}
                          onChange={async (e) => {
                            const val = e.target.value;
                            const ok = await updateTasker(tasker.id, { due_date: val || null });
                            if (ok) {
                              setTaskers((prev) =>
                                prev.map((t) =>
                                  t.id === tasker.id ? { ...t, due_date: val || null } : t
                                )
                              );
                            }
                          }}
                          className={`${selectClass} border-none shadow-sm shadow-black/5`}
                        />
                      </td>

                      {/* Log */}
                      <td className="px-4 py-4 whitespace-nowrap text-center">
                        <button
                          onClick={() => openLogModal(tasker)}
                          className="p-2 hover:bg-blue-500/10 rounded-xl transition-all active:scale-95 border border-transparent hover:border-blue-500/20"
                          title="View logs & chat"
                        >
                          <MessageCircle className="h-4 w-4 text-blue-500" />
                        </button>
                      </td>

                      {/* Help */}
                      <td className="px-4 py-4 whitespace-nowrap text-center">
                        <button
                          onClick={() => {
                            setHelpModal(tasker);
                            setHelpUser(tasker.help_request_user_name ?? '');
                          }}
                          className="p-2 hover:bg-orange-500/10 rounded-xl transition-all active:scale-95 border border-transparent hover:border-orange-500/20"
                          title={
                            tasker.help_request_user_name
                              ? `Help from: ${tasker.help_request_user_name}`
                              : 'Request help'
                          }
                        >
                          <HelpCircle
                            className={`h-4 w-4 ${
                              tasker.help_request_user_name
                                ? 'text-orange-500'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Issues */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-xs font-bold text-red-500/80 italic min-w-[100px]">
                          <EditableCell
                            tasker={tasker}
                            field="issues"
                            displayValue={tasker.issues ?? ''}
                          />
                        </div>
                      </td>

                      {/* Progress/Due info */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {(() => {
                          const dueDateStr = tasker.due_date;
                          if (!dueDateStr) return <span className="text-muted-foreground/40 font-bold text-[10px] uppercase tracking-wider">No Date</span>;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const due = new Date(dueDateStr + 'T00:00:00');
                          const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
                          if (diffDays < 0) {
                            return <span className="px-2 py-1 bg-red-500/10 text-red-500 rounded-lg font-bold text-[10px] uppercase tracking-wider border border-red-500/20">{Math.abs(diffDays)}d Overdue</span>;
                          }
                          if (diffDays === 0) {
                            return <span className="px-2 py-1 bg-yellow-500/10 text-yellow-500 rounded-lg font-bold text-[10px] uppercase tracking-wider border border-yellow-500/20">Today</span>;
                          }
                          return <span className="px-2 py-1 bg-green-500/10 text-green-500 rounded-lg font-bold text-[10px] uppercase tracking-wider border border-green-500/20">{diffDays}d Left</span>;
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">

                          {tasker.due_date && (
                            <a
                              href={(() => {
                                const d = tasker.due_date.replace(/-/g, '');
                                const title = encodeURIComponent(tasker.task_name);
                                const details = encodeURIComponent(
                                  [tasker.description, tasker.responsible_name ? `Responsible: ${tasker.responsible_name}` : ''].filter(Boolean).join('\n')
                                );
                                return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${d}/${d}&details=${details}`;
                              })()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                              title="Add to Google Calendar"
                            >
                              <Calendar className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => handleDelete(tasker.id)}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete tasker"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== CREATE TASKER MODAL ===== */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-card bg-background/90 border border-border/50 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <h2 className="text-xl font-bold tracking-tight">Create New Tasker</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-muted rounded-xl transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1">Task Name *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTasker.task_name}
                    onChange={(e) => setNewTasker({ ...newTasker, task_name: e.target.value })}
                    className={`${inputClass} flex-1${taskNameTooLong ? ' border-amber-400' : ''}`}
                    placeholder="Enter task name"
                  />
                  {taskerNamePrompt && (
                    <button
                      type="button"
                      onClick={handleGenerateTaskName}
                      disabled={generatingName}
                      title="Generate task name with AI"
                      className="px-2 py-1 border border-input rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {generatingName ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Sparkles className="h-4 w-4 text-accent" />}
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-xs ${taskNameTooLong ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {newTasker.task_name.length}/{TASK_NAME_MAX}
                  </span>
                </div>
                {taskNameTooLong && (
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Task name is too long. Keep it short and concise.</span>
                  </div>
                )}
                {suggestingName && (
                  <div className="mt-1 text-xs text-muted-foreground">Checking spelling...</div>
                )}
                {taskNameSuggestion && !suggestingName && (
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-blue-400">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Suggested:{' '}
                      <button
                        type="button"
                        onClick={() => { setNewTasker((prev) => ({ ...prev, task_name: taskNameSuggestion })); setTaskNameSuggestion(''); }}
                        className="text-accent hover:underline"
                      >
                        &quot;{taskNameSuggestion}&quot;
                      </button>
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={newTasker.description}
                  onChange={(e) => setNewTasker({ ...newTasker, description: e.target.value })}
                  className={inputClass + ' min-h-[80px]'}
                  placeholder="Task description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select
                    value={newTasker.status}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, status: e.target.value as Tasker['status'] })
                    }
                    className={inputClass}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    value={newTasker.priority}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, priority: parseInt(e.target.value) })
                    }
                    className={inputClass}
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {PRIORITY_LABELS[n]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Responsible <span className="text-muted-foreground font-normal">(defaults to you)</span>
                  </label>
                  <select
                    value={newTasker.responsible_name}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, responsible_name: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="">{`Default (${displayName || 'you'})`}</option>
                    {projectUserOptions.map((u) => (
                      <option key={`new-responsible-${u.user_name}`} value={u.user_name}>
                        {u.user_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CC</label>
                  <select
                    value={newTasker.cc_name}
                    onChange={(e) => setNewTasker({ ...newTasker, cc_name: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Who needs to know</option>
                    {projectUserOptions.map((u) => (
                      <option key={`new-cc-${u.user_name}`} value={u.user_name}>
                        {u.user_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">&quot;Got the Ball&quot;</label>
                  <select
                    value={newTasker.got_the_ball_name}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, got_the_ball_name: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="">Who actually does it</option>
                    {projectUserOptions.map((u) => (
                      <option key={`new-gtb-${u.user_name}`} value={u.user_name}>
                        {u.user_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newTasker.due_date}
                    onChange={(e) => setNewTasker({ ...newTasker, due_date: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Issues</label>
                <input
                  type="text"
                  value={newTasker.issues}
                  onChange={(e) => setNewTasker({ ...newTasker, issues: e.target.value })}
                  className={inputClass}
                  placeholder="Any issues"
                />
              </div>

              {/* Datalist for user autocomplete */}
              <datalist id="project-users">
                {projectUserOptions.map((u) => (
                  <option key={u.user_name} value={u.user_name} />
                ))}
              </datalist>

              <div className="flex items-center gap-3 pt-4 border-t border-border/50">
                <button
                  onClick={handleCreate}
                  disabled={creating || !newTasker.task_name.trim() || taskNameTooLong}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  CREATE TASKER
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-6 py-2.5 border border-border/50 rounded-xl text-sm font-bold hover:bg-muted transition-all active:scale-95"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== DESCRIPTION MODAL ===== */}
      {descriptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-card bg-background/90 border border-border/50 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight">Description: {descriptionModal.task_name}</h2>
              <button
                onClick={() => setDescriptionModal(null)}
                className="p-2 hover:bg-muted rounded-xl transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={descriptionModal.description ?? ''}
              onChange={(e) =>
                setDescriptionModal({ ...descriptionModal, description: e.target.value })
              }
              className={inputClass + ' min-h-[150px]'}
              placeholder="Add a description..."
            />
            <div className="flex items-center gap-3 mt-6 pt-6 border-t border-border/50">
              <button
                onClick={async () => {
                  if (!user) return;
                  const ok = await updateTasker(descriptionModal.id, {
                    description: descriptionModal.description,
                  });
                  if (ok) {
                    setTaskers((prev) =>
                      prev.map((t) =>
                        t.id === descriptionModal.id
                          ? { ...t, description: descriptionModal.description }
                          : t
                      )
                    );
                    await addTaskerLog({
                      tasker_id: descriptionModal.id,
                      user_id: user.id,
                      user_name: displayName,
                      type: 'change',
                      message: 'Updated description',
                    });
                    if (selectedProjectId) {
                      logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action: `Updated description for tasker "${descriptionModal.task_name}"` });
                    }
                  }
                  setDescriptionModal(null);
                }}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95"
              >
                SAVE
              </button>
              <button
                onClick={() => setDescriptionModal(null)}
                className="px-6 py-2.5 border border-border/50 rounded-xl text-sm font-bold hover:bg-muted transition-all active:scale-95"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== LOG / CHAT MODAL ===== */}
      {logModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-card bg-background/90 border border-border/50 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <h2 className="text-xl font-bold tracking-tight">Log: {logModal.task_name}</h2>
              <button
                onClick={() => {
                  setLogModal(null);
                  setLogs([]);
                  setNewMessage('');
                }}
                className="p-2 hover:bg-muted rounded-xl transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-[300px] bg-muted/10">
              {loadingLogs ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  <span className="text-sm font-bold uppercase tracking-widest">Loading Logs...</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground opacity-50">
                  <MessageCircle className="w-12 h-12 mb-2" />
                  <p className="text-sm font-bold uppercase tracking-widest">No logs yet.</p>
                  <p className="text-xs font-medium">Start the conversation below.</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex flex-col gap-1 ${
                      log.type === 'change'
                        ? 'items-center py-2'
                        : log.user_name === displayName 
                          ? 'items-end' 
                          : 'items-start'
                    }`}
                  >
                    {log.type === 'change' ? (
                      <div className="px-4 py-1.5 bg-muted/50 rounded-full border border-border/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                        {log.message}
                        <span className="opacity-50">— {new Date(log.created_at).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {log.user_name}
                          </span>
                          <span className="text-[9px] font-medium text-muted-foreground/50">
                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm font-medium shadow-sm border ${
                          log.user_name === displayName 
                            ? 'bg-accent text-accent-foreground rounded-tr-none border-accent/20' 
                            : 'bg-background border-border/50 rounded-tl-none'
                        }`}>
                          {log.message}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-6 border-t border-border/50 bg-background/50 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  className={inputClass}
                  placeholder="Type a message..."
                />
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMessage || !newMessage.trim()}
                  className="p-3 bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-50 transition-all active:scale-95 shadow-lg shadow-primary/20"
                >
                  {sendingMessage ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== HELP REQUEST MODAL ===== */}
      {helpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-card bg-background/90 border border-border/50 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight">Request Help</h2>
              <button
                onClick={() => {
                  setHelpModal(null);
                  setHelpUser('');
                }}
                className="p-2 hover:bg-muted rounded-xl transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 font-medium">
              Request help from a user for: <strong className="text-foreground">{helpModal.task_name}</strong>
            </p>
            <input
              type="text"
              value={helpUser}
              onChange={(e) => setHelpUser(e.target.value)}
              className={inputClass}
              placeholder="Enter user name"
              list="project-users-help"
            />
            <datalist id="project-users-help">
              {projectUserOptions.map((u) => (
                <option key={u.user_name} value={u.user_name} />
              ))}
            </datalist>
            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={handleHelpRequest}
                disabled={!helpUser.trim()}
                className="flex-1 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
              >
                SEND REQUEST
              </button>
              <button
                onClick={() => {
                  setHelpModal(null);
                  setHelpUser('');
                }}
                className="flex-1 px-6 py-2.5 border border-border/50 rounded-xl text-sm font-bold hover:bg-muted transition-all active:scale-95"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
