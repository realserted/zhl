'use client';

import { useState, useRef, useEffect } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, Upload, X, Loader2, FileUp } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { supabase } from '@/lib/supabase/client';
import { getDriveConfig } from '@/lib/db/files';

const STATUS_CONFIG: Record<string, { icon: typeof AlertCircle; colorClass: string }> = {
  Critical: { icon: AlertCircle, colorClass: 'border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950' },
  Problematic: { icon: AlertTriangle, colorClass: 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950' },
  'Needs Attention': { icon: AlertTriangle, colorClass: 'border-yellow-500 text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950' },
  Good: { icon: CheckCircle, colorClass: 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950' },
  Excellent: { icon: CheckCircle, colorClass: 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950' },
};

interface NavActionsProps {
  projectStatus?: string;
  /** Stack items vertically (for sidebar) */
  vertical?: boolean;
  selectedProjectId?: string | null;
}

interface UploadFile {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export default function NavActions({ projectStatus, vertical, selectedProjectId }: NavActionsProps) {
  const status = projectStatus || 'Good';
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['Good'];
  const Icon = config.icon;

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState<boolean | null>(null);
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if Drive is configured when modal opens
  useEffect(() => {
    if (!showUploadModal || !selectedProjectId) return;
    setDriveConfigured(null);
    getDriveConfig(selectedProjectId).then((cfg) => {
      setDriveConfigured(!!cfg);
      setRootFolderId(cfg?.root_folder_id ?? null);
    });
  }, [showUploadModal, selectedProjectId]);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ file: f, status: 'pending' as const })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpload = async () => {
    if (!selectedProjectId || !rootFolderId || uploadFiles.length === 0) return;

    setUploading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      setUploadFiles((prev) =>
        prev.map((f) => (f.status === 'pending' ? { ...f, status: 'error', error: 'Not authenticated' } : f))
      );
      setUploading(false);
      return;
    }

    for (let i = 0; i < uploadFiles.length; i++) {
      if (uploadFiles[i].status !== 'pending') continue;

      setUploadFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' } : f))
      );

      try {
        const formData = new FormData();
        formData.append('file', uploadFiles[i].file);
        formData.append('projectId', selectedProjectId);
        formData.append('folderId', rootFolderId);

        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }));
          setUploadFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, status: 'error', error: err.error } : f))
          );
        } else {
          setUploadFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, status: 'done' } : f))
          );
        }
      } catch {
        setUploadFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: 'error', error: 'Network error' } : f))
        );
      }
    }

    setUploading(false);
  };

  const allDone = uploadFiles.length > 0 && uploadFiles.every((f) => f.status === 'done' || f.status === 'error');
  const hasPending = uploadFiles.some((f) => f.status === 'pending');

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <div className={vertical ? 'flex flex-col gap-2' : 'flex gap-3 items-center'}>
        {/* Status Display */}
        <div
          className={`inline-flex items-center gap-2 border rounded-md px-3 py-1.5 text-xs font-semibold ${config.colorClass} ${vertical ? 'w-full justify-center' : 'px-4 py-2 text-sm'}`}
        >
          <Icon className="h-4 w-4" />
          Status: {status.toUpperCase()}
        </div>

        {/* Add Files Button */}
        {selectedProjectId && (
          <button
            onClick={() => {
              setShowUploadModal(true);
              setUploadFiles([]);
            }}
            className={`inline-flex items-center gap-2 border border-primary/30 rounded-md px-3 py-1.5 text-xs font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-colors ${vertical ? 'w-full justify-center' : 'px-4 py-2 text-sm'}`}
          >
            <Upload className="h-4 w-4" />
            ADD FILES
          </button>
        )}
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => {
          if (!uploading) {
            setShowUploadModal(false);
            setUploadFiles([]);
          }
        }}
        title="Upload Files to Google Drive"
        maxWidth="md"
      >
        <div className="space-y-4">
          {driveConfigured === null ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Checking Drive configuration...</span>
            </div>
          ) : !driveConfigured ? (
            <div className="text-center py-8">
              <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Google Drive not configured</p>
              <p className="text-xs text-muted-foreground">Set up Google Drive in the Files tab first.</p>
            </div>
          ) : (
            <>
              {/* Drop zone / file picker */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border/60 rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <FileUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">Click to select files</p>
                <p className="text-xs text-muted-foreground mt-1">Files will be uploaded to your project&apos;s Google Drive folder</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />
              </div>

              {/* File list */}
              {uploadFiles.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                  {uploadFiles.map((uf, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border/50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{uf.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatSize(uf.file.size)}</p>
                      </div>
                      {uf.status === 'pending' && (
                        <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {uf.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      {uf.status === 'done' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {uf.status === 'error' && (
                        <span className="text-[10px] text-destructive font-medium">{uf.error || 'Failed'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {allDone ? (
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadFiles([]);
                    }}
                    className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:opacity-90 transition-all"
                  >
                    DONE
                  </button>
                ) : (
                  <button
                    onClick={handleUpload}
                    disabled={uploading || !hasPending}
                    className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {uploading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                      </span>
                    ) : (
                      `UPLOAD ${uploadFiles.length > 0 ? `(${uploadFiles.filter((f) => f.status === 'pending').length})` : ''}`
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
