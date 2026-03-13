'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Tasker } from '@/lib/types/tasker';

const STATUS_OPTIONS = ['Open', 'In Progress', 'Complete', 'Archived'] as const;

const PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
  5: 'Critical',
};

const TASK_NAME_MAX = 30;

export interface CreateTaskerData {
  task_name: string;
  description: string;
  status: Tasker['status'];
  responsible_name: string;
  cc_name: string;
  got_the_ball_name: string;
  due_date: string;
  priority: number;
  issues: string;
}

interface CreateTaskerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateTaskerData) => Promise<void>;
  projectUserOptions: { user_id: string | null; user_name: string }[];
  displayName: string;
  taskerNamePrompt: string;
  selectedProjectName?: string | null;
}

export function CreateTaskerModal({
  isOpen,
  onClose,
  onCreate,
  projectUserOptions,
  displayName,
  taskerNamePrompt,
  selectedProjectName,
}: CreateTaskerModalProps) {
  const [creating, setCreating] = useState(false);
  const [newTasker, setNewTasker] = useState<CreateTaskerData>({
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

  // AI features
  const [generatingName, setGeneratingName] = useState(false);
  const [taskNameSuggestion, setTaskNameSuggestion] = useState('');
  const [suggestingName, setSuggestingName] = useState(false);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const taskNameTooLong = newTasker.task_name.length > TASK_NAME_MAX;

  // Auto-suggest improvements after debounce
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
          body: JSON.stringify({ type: 'task_name', prompt: instructions, context: name }),
        });
        const data = await res.json();
        const result = data.result?.trim();
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

  const handleCreate = async () => {
    if (!newTasker.task_name.trim()) return;
    setCreating(true);
    await onCreate(newTasker);
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
    setCreating(false);
  };

  const inputClass =
    'w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-xl text-sm font-medium transition-all focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Tasker" maxWidth="3xl">
      <div className="space-y-6 overflow-y-auto">
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
              onChange={(e) => setNewTasker({ ...newTasker, status: e.target.value as Tasker['status'] })}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Priority</label>
            <select
              value={newTasker.priority}
              onChange={(e) => setNewTasker({ ...newTasker, priority: parseInt(e.target.value) })}
              className={inputClass}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>)}
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
              onChange={(e) => setNewTasker({ ...newTasker, responsible_name: e.target.value })}
              className={inputClass}
            >
              <option value="">{`Default (${displayName || 'you'})`}</option>
              {projectUserOptions.map((u) => (
                <option key={`new-responsible-${u.user_name}`} value={u.user_name}>{u.user_name}</option>
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
                <option key={`new-cc-${u.user_name}`} value={u.user_name}>{u.user_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">&quot;Got the Ball&quot;</label>
            <select
              value={newTasker.got_the_ball_name}
              onChange={(e) => setNewTasker({ ...newTasker, got_the_ball_name: e.target.value })}
              className={inputClass}
            >
              <option value="">Who actually does it</option>
              {projectUserOptions.map((u) => (
                <option key={`new-gtb-${u.user_name}`} value={u.user_name}>{u.user_name}</option>
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

        <datalist id="project-users">
          {projectUserOptions.map((u) => (
            <option key={u.user_name} value={u.user_name} />
          ))}
        </datalist>

        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={handleCreate}
            disabled={creating || !newTasker.task_name.trim() || taskNameTooLong}
            className="w-full flex justify-center items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            CREATE TASKER
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
          >
            CANCEL
          </button>
        </div>
      </div>
    </Modal>
  );
}
