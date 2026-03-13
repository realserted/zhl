'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';

interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, fields: string[]) => void;
}

export function AddCategoryModal({ isOpen, onClose, onSubmit }: AddCategoryModalProps) {
  const [name, setName] = useState('');
  const [fields, setFields] = useState<string[]>(['']);

  const handleClose = () => {
    setName('');
    setFields(['']);
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(name, fields);
    setName('');
    setFields(['']);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Category" maxWidth="md">
      <div className="space-y-5">
        <div>
          <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Category Name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
            placeholder="Enter category name..."
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Fields (optional)</label>
          <div className="space-y-2">
            {fields.map((fieldName, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={fieldName}
                  onChange={(e) => {
                    const updated = [...fields];
                    updated[idx] = e.target.value;
                    setFields(updated);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (fieldName.trim() && idx === fields.length - 1) {
                        setFields((prev) => [...prev, '']);
                      } else if (!fieldName.trim() && fields.length > 1) {
                        handleSubmit();
                      }
                    }
                  }}
                  className="flex-1 px-4 py-2.5 bg-background/50 border border-primary/20 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
                  placeholder={`Field ${idx + 1} name...`}
                />
                {fields.length > 1 && (
                  <button
                    onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setFields((prev) => [...prev, ''])}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors ml-1"
            >
              <Plus className="h-3 w-3" /> Add another field
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            Create Category
          </button>
          <button
            onClick={handleClose}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
