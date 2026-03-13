'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { CategoryWithFields } from '@/lib/types/unit-data';

interface AddFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryWithFields[];
  onSubmit: (categoryId: string, name: string, tooltip: string) => void;
}

export function AddFieldModal({ isOpen, onClose, categories, onSubmit }: AddFieldModalProps) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tooltip, setTooltip] = useState('');

  useEffect(() => {
    if (isOpen && categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [isOpen, categories, categoryId]);

  const handleClose = () => {
    setName('');
    setTooltip('');
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(categoryId, name, tooltip);
    setName('');
    setTooltip('');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Custom Field" maxWidth="md">
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Category</label>
          <div className="relative">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium appearance-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Field Name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
            placeholder="Enter field name..."
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Tooltip</label>
          <input
            type="text"
            value={tooltip}
            onChange={(e) => setTooltip(e.target.value)}
            className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
            placeholder="Help text shown on hover..."
          />
        </div>
        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !categoryId}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            Create Field
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
