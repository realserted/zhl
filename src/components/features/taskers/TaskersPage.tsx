'use client';

import {
  Plus,
  Calendar,
  List,
  Loader2,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Tasker } from '@/lib/types/tasker';
import {
  getTaskers,
  createTasker,
  updateTasker,
  deleteTasker,
  addTaskerLog,
} from '@/lib/db/taskers';
import { createNotification } from '@/lib/db/notifications';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import { getProjectSettings } from '@/lib/db/project-settings';
import { CreateTaskerModal, CreateTaskerData } from './CreateTaskerModal';
import { TaskerLogModal } from './TaskerLogModal';
import { DescriptionModal } from './DescriptionModal';
import { HelpRequestModal } from './HelpRequestModal';
import { TaskerCalendarView } from './TaskerCalendarView';
import { TaskerTableRow } from './TaskerTableRow';

const STATUS_OPTIONS = ['Open', 'In Progress', 'Complete', 'Archived'] as const;

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
  const [selectedUserFilter, setSelectedUserFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [taskers, setTaskers] = useState<Tasker[]>([]);
  const [loading, setLoading] = useState(false);

  // Project users for dropdowns
  const [projectUsers, setProjectUsers] = useState<{ user_id: string | null; user_name: string }[]>([]);

  // Create modal + inline create row
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

  const TASK_NAME_MAX = 30;

  // Description modal
  const [descriptionModal, setDescriptionModal] = useState<Tasker | null>(null);

  // Log modal
  const [logModal, setLogModal] = useState<Tasker | null>(null);

  // Help modal
  const [helpModal, setHelpModal] = useState<Tasker | null>(null);

  // AI prompt state
  const [taskerNamePrompt, setTaskerNamePrompt] = useState('');

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
    });
  }, [selectedProjectId]);

  const { log, displayNameValue: displayName } = useUserLogger(selectedProjectId);

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
  const { permLevel, canEdit } = usePermission(userPermission, 'perm_taskers');
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

    // User filter from "Select" dropdown
    if (viewFilter === 'select' && selectedUserFilter) {
      return t.responsible === selectedUserFilter ||
        t.cc === selectedUserFilter ||
        t.got_the_ball === selectedUserFilter ||
        t.responsible_name === selectedUserFilter ||
        t.cc_name === selectedUserFilter ||
        t.got_the_ball_name === selectedUserFilter;
    }

    if (viewFilter === 'all') return true;
    if (viewFilter === 'relevant') return isAssignedTo(t);
    if (viewFilter === 'pm') {
      return t.responsible === user?.id || t.responsible_name === displayName;
    }
    return true;
  });

  // Create tasker handler — called from inline row (no arg) or modal (with data)
  const handleCreate = async (data?: CreateTaskerData) => {
    const d = data ?? newTasker;
    if (!user || !selectedProjectId || !d.task_name.trim()) return;
    setCreating(true);

    const responsibleName = d.responsible_name || displayName;
    const ccName = d.cc_name || null;
    const gotTheBallName = d.got_the_ball_name || null;

    const responsibleUser = responsibleName ? findProjectUserByName(responsibleName) : null;
    const ccUser = ccName ? findProjectUserByName(ccName) : null;
    const gotTheBallUser = gotTheBallName ? findProjectUserByName(gotTheBallName) : null;

    const tasker = await createTasker({
      project_id: selectedProjectId,
      status: d.status,
      task_name: d.task_name.trim(),
      description: d.description.trim() || null,
      update_status: null,
      responsible: responsibleUser?.user_id ?? null,
      responsible_name: responsibleName,
      cc: ccUser?.user_id ?? null,
      cc_name: ccName,
      got_the_ball: gotTheBallUser?.user_id ?? null,
      got_the_ball_name: gotTheBallName,
      priority: d.priority,
      due_date: d.due_date || null,
      original_due_date: d.due_date || null,
      help_request_user: null,
      help_request_user_name: null,
      issues: d.issues.trim() || null,
      created_by: user.id,
    });

    if (tasker) {
      setTaskers((prev) => [tasker, ...prev]);
      const assignedNames = [d.responsible_name, d.cc_name, d.got_the_ball_name].filter(Boolean) as string[];
      await Promise.all(assignedNames.map((name) => ensureUserHasProjectAccess(name)));

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
      log(`Created tasker "${tasker.task_name}"`);
      setNewTasker({
        task_name: '', description: '', status: 'Open', responsible_name: '',
        cc_name: '', got_the_ball_name: '', due_date: '', priority: 0, issues: '',
      });
    }
    setCreating(false);
    setShowCreate(false);
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
      log(`Updated tasker "${tasker.task_name}" — changed ${roleLabel[role]}`);
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
        log(`Updated tasker "${tasker.task_name}" — changed ${fieldLabel}`);
      }
    }
    setEditingCell(null);
  };

  // Help request handler (called from HelpRequestModal)
  const handleHelpRequest = async (taskerId: string, helpUserName: string) => {
    if (!user) return;
    const tasker = taskers.find((t) => t.id === taskerId);
    const ok = await updateTasker(taskerId, { help_request_user_name: helpUserName });
    if (ok) {
      setTaskers((prev) =>
        prev.map((t) => (t.id === taskerId ? { ...t, help_request_user_name: helpUserName } : t))
      );
      await addTaskerLog({
        tasker_id: taskerId,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Requested help from "${helpUserName}"`,
      });
      if (selectedProjectId && tasker) {
        log(`Requested help from "${helpUserName}" for tasker "${tasker.task_name}"`);
      }
    }
    setHelpModal(null);
  };

  // Description save handler (called from DescriptionModal)
  const handleDescriptionSave = async (taskerId: string, description: string) => {
    if (!user) return;
    const tasker = taskers.find((t) => t.id === taskerId);
    const ok = await updateTasker(taskerId, { description });
    if (ok) {
      setTaskers((prev) => prev.map((t) => (t.id === taskerId ? { ...t, description } : t)));
      await addTaskerLog({
        tasker_id: taskerId,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: 'Updated description',
      });
      if (selectedProjectId && tasker) {
        log(`Updated description for tasker "${tasker.task_name}"`);
      }
    }
  };

  // Delete tasker
  const handleDelete = async (taskerId: string) => {
    const tasker = taskers.find((t) => t.id === taskerId);
    const ok = await deleteTasker(taskerId);
    if (ok) {
      setTaskers((prev) => prev.filter((t) => t.id !== taskerId));
      if (user && selectedProjectId && tasker) {
        log(`Deleted tasker "${tasker.task_name}"`);
      }
    }
  };

  const selectClass = 'bg-muted/50 border border-border/50 rounded-lg px-2 py-1 text-[11px] font-bold transition-all focus:ring-2 focus:ring-primary/20 outline-none';

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
                  onClick={() => { setViewFilter(f.key); setSelectedUserFilter(null); }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    viewFilter === f.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {/* Select user filter */}
              <div className="relative">
                <button
                  onClick={() => setViewFilter(viewFilter === 'select' ? 'all' : 'select')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    viewFilter === 'select'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Select
                </button>
              </div>
            </div>
          </div>

          {viewFilter === 'select' && (
            <select
              value={selectedUserFilter ?? ''}
              onChange={(e) => setSelectedUserFilter(e.target.value || null)}
              className="px-3 py-1.5 bg-background border border-input rounded-lg text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
            >
              <option value="">Choose user...</option>
              {projectUserOptions.map((u) => (
                <option key={u.user_id ?? u.user_name} value={u.user_name}>{u.user_name}</option>
              ))}
            </select>
          )}

          <div className="h-4 w-px bg-border hidden lg:block" />

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
          <TaskerCalendarView
            calendarDate={calendarDate}
            setCalendarDate={setCalendarDate}
            filteredTaskers={filteredTaskers}
            onOpenLog={setLogModal}
          />
        ) : (
          /* Taskers Table */
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm">
            <table className="w-full text-xs sm:text-sm table-auto">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-1 py-3 w-[1%]" />
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Priority</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Due</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Task Name</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Description</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Log</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Responsible</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">CC</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">&quot;Got the Ball&quot;</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Issues</th>
                  <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {/* Inline create row — always visible for editors */}
                {canEdit && (
                  <tr className="border-b border-primary/20 bg-primary/[0.03]">
                    {/* Create button */}
                    <td className="px-1 py-2 whitespace-nowrap">
                      <button
                        onClick={() => handleCreate()}
                        disabled={creating || !newTasker.task_name.trim()}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded text-[10px] font-bold disabled:opacity-40 hover:opacity-90 transition-all"
                      >
                        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      </button>
                    </td>
                    {/* Status */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <select
                        value={newTasker.status}
                        onChange={(e) => setNewTasker((p) => ({ ...p, status: e.target.value as Tasker['status'] }))}
                        className={`${selectClass} text-[10px] w-full`}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    {/* Priority */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <select
                        value={newTasker.priority}
                        onChange={(e) => setNewTasker((p) => ({ ...p, priority: Number(e.target.value) }))}
                        className={`${selectClass} text-[10px]`}
                      >
                        {Object.entries(PRIORITY_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    </td>
                    {/* Due Date */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <input
                        type="date"
                        value={newTasker.due_date}
                        onChange={(e) => setNewTasker((p) => ({ ...p, due_date: e.target.value }))}
                        className="px-1 py-1 bg-background/50 border border-input rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </td>
                    {/* Task Name */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <input
                        value={newTasker.task_name}
                        onChange={(e) => setNewTasker((p) => ({ ...p, task_name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        placeholder="Task name..."
                        className="w-full px-2 py-1 bg-background/50 border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </td>
                    {/* Description */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <input
                        value={newTasker.description}
                        onChange={(e) => setNewTasker((p) => ({ ...p, description: e.target.value }))}
                        placeholder="Description..."
                        className="w-full px-2 py-1 bg-background/50 border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </td>
                    {/* Log — empty */}
                    <td className="px-2 py-2" />
                    {/* Responsible */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <select
                        value={newTasker.responsible_name}
                        onChange={(e) => setNewTasker((p) => ({ ...p, responsible_name: e.target.value }))}
                        className={`${selectClass} text-[10px] w-full`}
                      >
                        <option value="">—</option>
                        {projectUserOptions.map((u) => <option key={u.user_id ?? u.user_name} value={u.user_name}>{u.user_name}</option>)}
                      </select>
                    </td>
                    {/* CC */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <select
                        value={newTasker.cc_name}
                        onChange={(e) => setNewTasker((p) => ({ ...p, cc_name: e.target.value }))}
                        className={`${selectClass} text-[10px] w-full`}
                      >
                        <option value="">—</option>
                        {projectUserOptions.map((u) => <option key={u.user_id ?? u.user_name} value={u.user_name}>{u.user_name}</option>)}
                      </select>
                    </td>
                    {/* Got the Ball */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <select
                        value={newTasker.got_the_ball_name}
                        onChange={(e) => setNewTasker((p) => ({ ...p, got_the_ball_name: e.target.value }))}
                        className={`${selectClass} text-[10px] w-full`}
                      >
                        <option value="">—</option>
                        {projectUserOptions.map((u) => <option key={u.user_id ?? u.user_name} value={u.user_name}>{u.user_name}</option>)}
                      </select>
                    </td>
                    {/* Issues */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <input
                        value={newTasker.issues}
                        onChange={(e) => setNewTasker((p) => ({ ...p, issues: e.target.value }))}
                        placeholder="Issues..."
                        className="w-full px-2 py-1 bg-background/50 border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </td>
                    {/* Actions — empty for create row */}
                    <td className="px-2 py-2" />
                  </tr>
                )}
                {filteredTaskers.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
                      No taskers yet. Fill in the row above and click CREATE.
                    </td>
                  </tr>
                ) : (
                  filteredTaskers.map((tasker) => (
                    <TaskerTableRow
                      key={tasker.id}
                      tasker={tasker}
                      user={user}
                      displayName={displayName}
                      canEdit={canEdit}
                      isAssignedTo={isAssignedTo}
                      projectUserOptions={projectUserOptions}
                      selectClass={selectClass}
                      editingCell={editingCell}
                      editValue={editValue}
                      setEditingCell={setEditingCell}
                      setEditValue={setEditValue}
                      saveInlineEdit={saveInlineEdit}
                      setTaskers={setTaskers}
                      handleRoleUpdate={handleRoleUpdate}
                      handleDelete={handleDelete}
                      setLogModal={setLogModal}
                      setDescriptionModal={setDescriptionModal}
                      selectedProjectId={selectedProjectId}
                      log={log}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== MODALS ===== */}
      <CreateTaskerModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        projectUserOptions={projectUserOptions}
        displayName={displayName}
        taskerNamePrompt={taskerNamePrompt}
        selectedProjectName={selectedProjectName}
      />
      <TaskerLogModal
        tasker={logModal}
        onClose={() => setLogModal(null)}
        userId={user?.id ?? ''}
        displayName={displayName}
      />
      <DescriptionModal
        tasker={descriptionModal}
        onClose={() => setDescriptionModal(null)}
        onSave={handleDescriptionSave}
      />
      <HelpRequestModal
        tasker={helpModal}
        onClose={() => setHelpModal(null)}
        onSubmit={handleHelpRequest}
        projectUserOptions={projectUserOptions}
      />
    </main>
  );
}
