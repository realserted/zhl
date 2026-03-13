'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Tasker } from '@/lib/types/tasker';

interface DescriptionModalProps {
  tasker: Tasker | null;
  onClose: () => void;
  onSave: (taskerId: string, description: string) => Promise<void>;
}

export function DescriptionModal({ tasker, onClose, onSave }: DescriptionModalProps) {
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (tasker) setDescription(tasker.description ?? '');
  }, [tasker]);

  const inputClass =
    'w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-xl text-sm font-medium transition-all focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50';

  return (
    <Modal
      isOpen={!!tasker}
      onClose={onClose}
      title={`Description: ${tasker?.task_name}`}
      maxWidth="lg"
    >
      <div className="flex flex-col gap-6">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass + ' min-h-[150px]'}
          placeholder="Add a description..."
        />
        <div className="flex flex-col gap-3">
          <button
            onClick={async () => {
              if (!tasker) return;
              await onSave(tasker.id, description);
              onClose();
            }}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98]"
          >
            SAVE
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
