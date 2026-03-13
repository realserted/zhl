'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Tasker } from '@/lib/types/tasker';

interface HelpRequestModalProps {
  tasker: Tasker | null;
  onClose: () => void;
  onSubmit: (taskerId: string, helpUserName: string) => Promise<void>;
  projectUserOptions: { user_id: string | null; user_name: string }[];
}

export function HelpRequestModal({ tasker, onClose, onSubmit, projectUserOptions }: HelpRequestModalProps) {
  const [helpUser, setHelpUser] = useState('');

  const handleClose = () => {
    setHelpUser('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!tasker || !helpUser.trim()) return;
    await onSubmit(tasker.id, helpUser.trim());
    setHelpUser('');
  };

  const inputClass =
    'w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-xl text-sm font-medium transition-all focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50';

  return (
    <Modal
      isOpen={!!tasker}
      onClose={handleClose}
      title="Request Help"
      maxWidth="sm"
      description={`Request help from a user for: ${tasker?.task_name}`}
    >
      <div className="space-y-6">
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
        <div className="flex flex-col gap-3">
          <button
            onClick={handleSubmit}
            disabled={!helpUser.trim()}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            SEND REQUEST
          </button>
          <button
            onClick={handleClose}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
          >
            CANCEL
          </button>
        </div>
      </div>
    </Modal>
  );
}
