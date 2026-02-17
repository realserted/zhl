'use client';

import {
  Plus,
  Calendar,
  MessageCircle,
  HelpCircle,
  X,
  Send,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { Tasker, TaskerLog } from '../../lib/types/tasker';
import {
  getTaskers,
  createTasker,
  updateTasker,
  deleteTasker,
  getTaskerLogs,
  addTaskerLog,
} from '../../lib/db/taskers';

const STATUS_OPTIONS = ['Open', 'In Progress', 'Complete', 'Archived'] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  Complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Archived: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

interface TaskersPageProps {
  selectedProjectId: string | null;
}

export default function TaskersPage({ selectedProjectId }: TaskersPageProps) {
  const { user } = useAuth();
  const [viewFilter, setViewFilter] = useState('all');
  const [taskers, setTaskers] = useState<Tasker[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // Load project users
  useEffect(() => {
    if (!selectedProjectId) return;
    supabase
      .from('project_permissions')
      .select('user_id, user_name')
      .eq('project_id', selectedProjectId)
      .then(({ data }) => {
        setProjectUsers(data ?? []);
      });
  }, [selectedProjectId]);

  // Load taskers when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setTaskers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getTaskers(selectedProjectId).then((data) => {
      setTaskers(data);
      setLoading(false);
    });
  }, [selectedProjectId]);

  // Get current user display name
  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
      .select('display_name')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? user.user_metadata?.display_name ?? 'Unknown');
      });
  }, [user]);

  // Filter taskers
  const filteredTaskers = taskers.filter((t) => {
    if (viewFilter === 'all') return true;
    if (viewFilter === 'relevant') {
      return (
        t.responsible === user?.id ||
        t.cc === user?.id ||
        t.got_the_ball === user?.id ||
        t.created_by === user?.id ||
        t.responsible_name === displayName ||
        t.cc_name === displayName ||
        t.got_the_ball_name === displayName
      );
    }
    if (viewFilter === 'pm') {
      return t.responsible === user?.id || t.responsible_name === displayName;
    }
    return true;
  });

  // Create tasker handler
  const handleCreate = async () => {
    if (!user || !selectedProjectId || !newTasker.task_name.trim()) return;
    setCreating(true);

    const tasker = await createTasker({
      project_id: selectedProjectId,
      status: newTasker.status,
      task_name: newTasker.task_name.trim(),
      description: newTasker.description.trim() || null,
      update_status: null,
      responsible: null,
      responsible_name: newTasker.responsible_name || displayName,
      cc: null,
      cc_name: newTasker.cc_name || null,
      got_the_ball: null,
      got_the_ball_name: newTasker.got_the_ball_name || null,
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
      await addTaskerLog({
        tasker_id: tasker.id,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Created tasker "${tasker.task_name}"`,
      });
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

  // Inline field save
  const saveInlineEdit = async (taskerId: string, field: string, value: string) => {
    const tasker = taskers.find((t) => t.id === taskerId);
    if (!tasker || !user) return;

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
      const fieldLabel = field.replace(/_/g, ' ');
      await addTaskerLog({
        tasker_id: taskerId,
        user_id: user.id,
        user_name: displayName,
        type: 'change',
        message: `Changed ${fieldLabel} from "${oldValue ?? ''}" to "${value}"`,
      });
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
    }
    setHelpModal(null);
    setHelpUser('');
  };

  // Delete tasker
  const handleDelete = async (taskerId: string) => {
    const ok = await deleteTasker(taskerId);
    if (ok) setTaskers((prev) => prev.filter((t) => t.id !== taskerId));
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

    return (
      <span
        onClick={() => {
          setEditingCell({ id: tasker.id, field });
          setEditValue(displayValue);
        }}
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded block min-w-[2rem] min-h-[1.25rem]"
        title="Click to edit"
      >
        {displayValue || <span className="text-muted-foreground/40">-</span>}
      </span>
    );
  };

  const selectClass = 'border border-input rounded px-2 py-1 bg-background text-foreground text-xs';
  const inputClass =
    'w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-full px-4 sm:px-6 py-6 sm:py-8">
        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">Your Taskers</h1>

        {/* View Taskers and Create Section */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-6 sm:mb-8">
          {/* View Taskers Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <span className="font-semibold text-sm sm:text-base">View Taskers:</span>
            <div className="flex gap-2 sm:gap-4 flex-wrap">
              {[
                { key: 'all', label: 'All Taskers' },
                { key: 'relevant', label: 'Only relevant' },
                { key: 'pm', label: 'Only PM' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setViewFilter(f.key)}
                  className={`text-xs sm:text-sm hover:text-accent transition-colors ${
                    viewFilter === f.key ? 'text-accent font-semibold' : ''
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Create Tasker Button */}
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 transition-colors"
          >
            <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
            Create tasker
          </button>

          {/* Calendar View Link */}
          <button className="sm:ml-auto inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
            <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">(calendar view)</span>
            <span className="sm:hidden">Calendar</span>
          </button>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading taskers...
          </div>
        ) : !selectedProjectId ? (
          <p className="text-sm text-muted-foreground py-8">No project selected. Create a project in Settings first.</p>
        ) : (
          /* Taskers Table */
          <div className="overflow-x-auto border border-input rounded-lg">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-input">
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Status</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Task Name</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Description</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Update Status</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Responsible</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">CC</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">&quot;Got the Ball&quot;</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Priority</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Due</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Log</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Help</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Issues</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Original due vs now</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap"></th>
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
                      className="border-b border-input hover:bg-muted/50 transition-colors"
                    >
                      {/* Status dropdown */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <select
                          className={`${selectClass} ${STATUS_COLORS[tasker.status] || ''}`}
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
                      <td className="px-3 py-3 whitespace-nowrap font-medium">
                        <EditableCell
                          tasker={tasker}
                          field="task_name"
                          displayValue={tasker.task_name}
                        />
                      </td>

                      {/* Description - clickable link to open modal */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          onClick={() => setDescriptionModal(tasker)}
                          className="text-accent hover:underline text-xs max-w-[150px] truncate block"
                          title={tasker.description || 'Add description'}
                        >
                          {tasker.description
                            ? tasker.description.length > 30
                              ? tasker.description.slice(0, 30) + '...'
                              : tasker.description
                            : 'Add description'}
                        </button>
                      </td>

                      {/* Update Status (2nd status - user comments) */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <EditableCell
                          tasker={tasker}
                          field="update_status"
                          displayValue={tasker.update_status ?? ''}
                        />
                      </td>

                      {/* Responsible */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <EditableCell
                          tasker={tasker}
                          field="responsible_name"
                          displayValue={tasker.responsible_name ?? ''}
                        />
                      </td>

                      {/* CC */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <EditableCell
                          tasker={tasker}
                          field="cc_name"
                          displayValue={tasker.cc_name ?? ''}
                        />
                      </td>

                      {/* Got the Ball */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <EditableCell
                          tasker={tasker}
                          field="got_the_ball_name"
                          displayValue={tasker.got_the_ball_name ?? ''}
                        />
                      </td>

                      {/* Priority */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <select
                          className={selectClass}
                          value={tasker.priority}
                          onChange={async (e) => {
                            const newPriority = parseInt(e.target.value);
                            const ok = await updateTasker(tasker.id, { priority: newPriority });
                            if (ok) {
                              setTaskers((prev) =>
                                prev.map((t) =>
                                  t.id === tasker.id ? { ...t, priority: newPriority } : t
                                )
                              );
                            }
                          }}
                        >
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n === 0 ? 'None' : '★'.repeat(n)}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Due Date */}
                      <td className="px-3 py-3 whitespace-nowrap">
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
                          className="bg-background border border-input rounded px-1 py-0.5 text-xs"
                        />
                      </td>

                      {/* Log */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          onClick={() => openLogModal(tasker)}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          title="View logs & chat"
                        >
                          <MessageCircle className="h-4 w-4 text-blue-500" />
                        </button>
                      </td>

                      {/* Help */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          onClick={() => {
                            setHelpModal(tasker);
                            setHelpUser(tasker.help_request_user_name ?? '');
                          }}
                          className="p-1 hover:bg-muted rounded transition-colors"
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
                      <td className="px-3 py-3 whitespace-nowrap">
                        <EditableCell
                          tasker={tasker}
                          field="issues"
                          displayValue={tasker.issues ?? ''}
                        />
                      </td>

                      {/* Original due date vs now */}
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">
                        {tasker.original_due_date && tasker.due_date
                          ? tasker.original_due_date === tasker.due_date
                            ? 'On track'
                            : `${tasker.original_due_date} → ${tasker.due_date}`
                          : tasker.original_due_date ?? '-'}
                      </td>

                      {/* Delete */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          onClick={() => handleDelete(tasker.id)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete tasker"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Create New Tasker</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Task Name *</label>
                <input
                  type="text"
                  value={newTasker.task_name}
                  onChange={(e) => setNewTasker({ ...newTasker, task_name: e.target.value })}
                  className={inputClass}
                  placeholder="Enter task name"
                />
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
                        {n === 0 ? 'None' : '★'.repeat(n)}
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
                  <input
                    type="text"
                    value={newTasker.responsible_name}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, responsible_name: e.target.value })
                    }
                    className={inputClass}
                    placeholder={displayName}
                    list="project-users"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CC</label>
                  <input
                    type="text"
                    value={newTasker.cc_name}
                    onChange={(e) => setNewTasker({ ...newTasker, cc_name: e.target.value })}
                    className={inputClass}
                    placeholder="Who needs to know"
                    list="project-users"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">&quot;Got the Ball&quot;</label>
                  <input
                    type="text"
                    value={newTasker.got_the_ball_name}
                    onChange={(e) =>
                      setNewTasker({ ...newTasker, got_the_ball_name: e.target.value })
                    }
                    className={inputClass}
                    placeholder="Who actually does it"
                    list="project-users"
                  />
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
                {projectUsers.map((u) => (
                  <option key={u.user_name} value={u.user_name} />
                ))}
              </datalist>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleCreate}
                  disabled={creating || !newTasker.task_name.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Tasker
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== DESCRIPTION MODAL ===== */}
      {descriptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Description: {descriptionModal.task_name}</h2>
              <button
                onClick={() => setDescriptionModal(null)}
                className="p-1 hover:bg-muted rounded"
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
            <div className="flex items-center gap-3 mt-4">
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
                  }
                  setDescriptionModal(null);
                }}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90"
              >
                Save
              </button>
              <button
                onClick={() => setDescriptionModal(null)}
                className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== LOG / CHAT MODAL ===== */}
      {logModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-bold">Log: {logModal.task_name}</h2>
              <button
                onClick={() => {
                  setLogModal(null);
                  setLogs([]);
                  setNewMessage('');
                }}
                className="p-1 hover:bg-muted rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
              {loadingLogs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No logs yet. Start the conversation.
                </p>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className={`text-sm ${
                      log.type === 'change'
                        ? 'text-muted-foreground italic border-l-2 border-border pl-3'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-xs">
                        {log.user_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                      {log.type === 'change' && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">change</span>
                      )}
                    </div>
                    <p>{log.message}</p>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-2">
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
                  className="p-2 bg-accent text-accent-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {sendingMessage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== HELP REQUEST MODAL ===== */}
      {helpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Request Help</h2>
              <button
                onClick={() => {
                  setHelpModal(null);
                  setHelpUser('');
                }}
                className="p-1 hover:bg-muted rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Request help from a user for: <strong>{helpModal.task_name}</strong>
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
              {projectUsers.map((u) => (
                <option key={u.user_name} value={u.user_name} />
              ))}
            </datalist>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleHelpRequest}
                disabled={!helpUser.trim()}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Send Request
              </button>
              <button
                onClick={() => {
                  setHelpModal(null);
                  setHelpUser('');
                }}
                className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
