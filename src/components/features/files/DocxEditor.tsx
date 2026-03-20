'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Save,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered,
} from 'lucide-react';
import { Button } from '@/components/shared/Button';
import DOMPurify from 'isomorphic-dompurify';

interface DocxEditorProps {
  initialHtml: string;
  onSave: (html: string) => Promise<{ ok: boolean; error?: string }>;
  readOnly?: boolean;
}

export function DocxEditor({ initialHtml, onSave, readOnly }: DocxEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const execCmd = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    setSaving(true);
    setSaveStatus(null);

    try {
      const htmlContent = editorRef.current.innerHTML;
      const result = await onSave(htmlContent);
      if (result.ok) {
        setSaveStatus('Saved!');
        setHasChanges(false);
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus(result.error || 'Failed to save');
      }
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('Failed to save');
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  const ToolbarBtn = ({ cmd, icon: Icon, title, active }: {
    cmd: string; icon: React.ElementType; title: string; active?: boolean;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); execCmd(cmd); }}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-1 border-b border-border/40 px-3 py-1.5 bg-muted/20 shrink-0 flex-wrap">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            isLoading={saving}
            className="gap-1.5 text-[11px] font-bold mr-2"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>

          <div className="h-5 w-px bg-border/40 mx-1" />

          <ToolbarBtn cmd="bold" icon={Bold} title="Bold (Ctrl+B)" />
          <ToolbarBtn cmd="italic" icon={Italic} title="Italic (Ctrl+I)" />
          <ToolbarBtn cmd="underline" icon={Underline} title="Underline (Ctrl+U)" />
          <ToolbarBtn cmd="strikeThrough" icon={Strikethrough} title="Strikethrough" />

          <div className="h-5 w-px bg-border/40 mx-1" />

          <ToolbarBtn cmd="justifyLeft" icon={AlignLeft} title="Align Left" />
          <ToolbarBtn cmd="justifyCenter" icon={AlignCenter} title="Align Center" />
          <ToolbarBtn cmd="justifyRight" icon={AlignRight} title="Align Right" />

          <div className="h-5 w-px bg-border/40 mx-1" />

          <ToolbarBtn cmd="insertUnorderedList" icon={List} title="Bullet List" />
          <ToolbarBtn cmd="insertOrderedList" icon={ListOrdered} title="Numbered List" />

          <div className="h-5 w-px bg-border/40 mx-1" />

          <select
            onChange={(e) => { if (e.target.value) execCmd('formatBlock', e.target.value); }}
            className="bg-transparent border border-border/30 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground cursor-pointer"
            defaultValue=""
          >
            <option value="" disabled>Heading</option>
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>

          <select
            onChange={(e) => { if (e.target.value) execCmd('fontSize', e.target.value); }}
            className="bg-transparent border border-border/30 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground cursor-pointer"
            defaultValue=""
          >
            <option value="" disabled>Size</option>
            <option value="1">Small</option>
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="7">Huge</option>
          </select>

          {saveStatus && (
            <span className={`ml-auto text-[11px] font-bold ${
              saveStatus === 'Saved!' ? 'text-green-500' : 'text-red-400'
            }`}>
              {saveStatus}
            </span>
          )}
          {hasChanges && !saveStatus && (
            <span className="ml-auto text-[11px] text-amber-500 font-medium">Unsaved changes</span>
          )}
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-auto bg-white">
        <div
          ref={editorRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={() => setHasChanges(true)}
          className="prose prose-sm max-w-none p-8 text-black min-h-full outline-none focus:outline-none [&_a]:text-blue-600"
          style={{ minHeight: '100%' }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(initialHtml) }}
        />
      </div>
    </div>
  );
}
