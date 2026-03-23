'use client';

import { Calendar, MessageCircle, Trash2 } from 'lucide-react';
import { Tasker } from '@/lib/types/tasker';
import { updateTasker, addTaskerLog } from '@/lib/db/taskers';

const STATUS_OPTIONS = ['Open', 'In Progress', 'Complete', 'Archived'] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  Complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Archived: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent', 5: 'Critical',
};

interface TaskerTableRowProps {
  tasker: Tasker;
  user: { id: string } | null;
  displayName: string;
  canEdit: boolean;
  isAssignedTo: (t: Tasker) => boolean;
  projectUserOptions: { user_id: string | null; user_name: string }[];
  selectClass: string;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  setEditValue: (v: string) => void;
  saveInlineEdit: (taskerId: string, field: string, value: string) => Promise<void>;
  setTaskers: React.Dispatch<React.SetStateAction<Tasker[]>>;
  handleRoleUpdate: (tasker: Tasker, role: 'responsible' | 'cc' | 'got_the_ball', name: string) => Promise<void>;
  handleDelete: (taskerId: string) => Promise<void>;
  setLogModal: (t: Tasker) => void;
  setDescriptionModal: (t: Tasker) => void;
  selectedProjectId: string | null;
  log: (msg: string) => void;
}

function EditableCell({
  tasker,
  field,
  displayValue,
  type = 'text',
  canEdit,
  isAssignedTo,
  editingCell,
  editValue,
  setEditingCell,
  setEditValue,
  saveInlineEdit,
}: {
  tasker: Tasker;
  field: string;
  displayValue: string;
  type?: string;
  canEdit: boolean;
  isAssignedTo: (t: Tasker) => boolean;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  setEditValue: (v: string) => void;
  saveInlineEdit: (taskerId: string, field: string, value: string) => Promise<void>;
}) {
  const isEditing = editingCell?.id === tasker.id && editingCell?.field === field;
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
}

export function TaskerTableRow({
  tasker, user, displayName, canEdit, isAssignedTo, projectUserOptions,
  selectClass, editingCell, editValue, setEditingCell, setEditValue,
  saveInlineEdit, setTaskers, handleRoleUpdate, handleDelete,
  setLogModal, setDescriptionModal, selectedProjectId, log,
}: TaskerTableRowProps) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
      <td className="px-1 py-3" />

      {/* Status dropdown */}
      <td className="px-2 py-3 whitespace-nowrap">
        <select
          disabled={!canEdit}
          className={`${selectClass} ${STATUS_COLORS[tasker.status] || ''} ${!canEdit ? 'opacity-75 cursor-default' : ''} border-none shadow-sm shadow-black/5`}
          value={tasker.status}
          onChange={async (e) => {
            const newStatus = e.target.value as Tasker['status'];
            const ok = await updateTasker(tasker.id, { status: newStatus });
            if (ok) {
              setTaskers((prev) => prev.map((t) => t.id === tasker.id ? { ...t, status: newStatus } : t));
              if (user) {
                await addTaskerLog({
                  tasker_id: tasker.id, user_id: user.id, user_name: displayName,
                  type: 'change', message: `Changed status from "${tasker.status}" to "${newStatus}"`,
                });
                if (selectedProjectId) log(`Changed tasker "${tasker.task_name}" status to "${newStatus}"`);
              }
            }
          }}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>

      {/* Priority */}
      <td className="px-2 py-3 whitespace-nowrap">
        <select
          className={`${selectClass} border-none shadow-sm shadow-black/5`}
          value={tasker.priority}
          onChange={async (e) => {
            const newPriority = parseInt(e.target.value);
            const oldPriority = tasker.priority;
            const ok = await updateTasker(tasker.id, { priority: newPriority });
            if (ok) {
              setTaskers((prev) => prev.map((t) => t.id === tasker.id ? { ...t, priority: newPriority } : t));
              if (user) {
                const priorityLabel = (p: number) => PRIORITY_LABELS[p] ?? 'None';
                await addTaskerLog({
                  tasker_id: tasker.id, user_id: user.id, user_name: displayName,
                  type: 'change', message: `Changed Priority from "${priorityLabel(oldPriority)}" to "${priorityLabel(newPriority)}"`,
                });
                if (selectedProjectId) log(`Updated tasker "${tasker.task_name}" — changed Priority`);
              }
            }
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>)}
        </select>
      </td>

      {/* Due Date */}
      <td className="px-2 py-3 whitespace-nowrap">
        <input
          type="date"
          value={tasker.due_date ?? ''}
          onChange={async (e) => {
            const val = e.target.value;
            const ok = await updateTasker(tasker.id, { due_date: val || null });
            if (ok) setTaskers((prev) => prev.map((t) => t.id === tasker.id ? { ...t, due_date: val || null } : t));
          }}
          className={`${selectClass} border-none shadow-sm shadow-black/5`}
        />
        {(() => {
          const orig = tasker.original_due_date;
          const curr = tasker.due_date;
          if (!orig || !curr || orig === curr) return null;
          const diffDays = Math.round((new Date(curr + 'T00:00:00').getTime() - new Date(orig + 'T00:00:00').getTime()) / 86_400_000);
          if (diffDays <= 0) return null;
          return (
            <div className="text-[9px] font-semibold text-red-500 mt-0.5">
              (+{diffDays} {diffDays === 1 ? 'day' : 'days'} from original date)
            </div>
          );
        })()}
      </td>

      {/* Task Name */}
      <td className="px-2 py-3 whitespace-nowrap">
        <div className="font-bold text-sm tracking-tight">
          <EditableCell tasker={tasker} field="task_name" displayValue={tasker.task_name}
            canEdit={canEdit} isAssignedTo={isAssignedTo} editingCell={editingCell} editValue={editValue}
            setEditingCell={setEditingCell} setEditValue={setEditValue} saveInlineEdit={saveInlineEdit} />
        </div>
      </td>

      {/* Description */}
      <td className="px-2 py-3 whitespace-nowrap">
        <button
          onClick={() => setDescriptionModal(tasker)}
          className="text-primary hover:underline text-xs font-bold leading-none max-w-[150px] truncate block"
          title={tasker.description || 'Add description'}
        >
          {tasker.description
            ? tasker.description.length > 30 ? tasker.description.slice(0, 30) + '...' : tasker.description
            : '+ Description'}
        </button>
      </td>

      {/* Log */}
      <td className="px-2 py-3 whitespace-nowrap text-center">
        <button onClick={() => setLogModal(tasker)}
          className="p-1.5 hover:bg-blue-500/10 rounded-xl transition-all active:scale-95 border border-transparent hover:border-blue-500/20"
          title="View logs & chat">
          <MessageCircle className="h-4 w-4 text-blue-500" />
        </button>
      </td>

      {/* Responsible / CC / Got the Ball */}
      {(['responsible', 'cc', 'got_the_ball'] as const).map((role) => {
        const nameKey = `${role}_name` as keyof Tasker;
        const value = (tasker[nameKey] as string | null) ?? '';
        return (
          <td key={role} className="px-2 py-3 whitespace-nowrap">
            {canEdit ? (
              <select value={value} onChange={(e) => handleRoleUpdate(tasker, role, e.target.value)} className={selectClass}>
                <option value="">-</option>
                {projectUserOptions.map((u) => (
                  <option key={`${role}-${u.user_name}`} value={u.user_name}>{u.user_name}</option>
                ))}
              </select>
            ) : (
              <span className="px-2 py-1 block text-xs font-bold text-muted-foreground bg-muted/30 rounded-lg min-w-8">
                {value || '-'}
              </span>
            )}
          </td>
        );
      })}

      {/* Issues */}
      <td className="px-2 py-3 whitespace-nowrap">
        <div className="text-xs font-bold text-red-500/80 italic">
          <EditableCell tasker={tasker} field="issues" displayValue={tasker.issues ?? ''}
            canEdit={canEdit} isAssignedTo={isAssignedTo} editingCell={editingCell} editValue={editValue}
            setEditingCell={setEditingCell} setEditValue={setEditValue} saveInlineEdit={saveInlineEdit} />
        </div>
      </td>

      {/* Actions */}
      <td className="px-2 py-3 whitespace-nowrap">
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
              target="_blank" rel="noopener noreferrer"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Add to Google Calendar"
            >
              <Calendar className="h-3.5 w-3.5" />
            </a>
          )}
          {canEdit && (
            <button onClick={() => handleDelete(tasker.id)}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Delete tasker">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
