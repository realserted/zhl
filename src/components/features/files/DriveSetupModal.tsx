'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { FolderOpen, CheckCircle } from 'lucide-react';
import { upsertDriveConfig, ensureArchiveFolder } from '@/lib/db/files';

interface DriveSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  userId: string | null;
  onConfigured: () => void;
}

/** Extract Google Drive folder ID from a pasted URL. */
function extractFolderId(url: string): string | null {
  // Handles:
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Maybe they pasted just the ID
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) return url.trim();

  return null;
}

export default function DriveSetupModal({ isOpen, onClose, projectId, userId, onConfigured }: DriveSetupModalProps) {
  const [driveUrl, setDriveUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderId = extractFolderId(driveUrl);

  const handleSave = async () => {
    setError(null);

    if (!folderId) {
      setError('Could not extract a valid folder ID from the URL.');
      return;
    }

    setSaving(true);

    try {
      const config = await upsertDriveConfig({
        projectId,
        rootFolderId: folderId,
        rootFolderUrl: driveUrl.trim(),
        configuredBy: userId,
      });

      if (!config) {
        setError('Failed to save configuration. Please try again.');
        setSaving(false);
        return;
      }

      // Try to create the ARCHIVE folder
      const archiveId = await ensureArchiveFolder(projectId, folderId);
      if (archiveId) {
        await upsertDriveConfig({
          projectId,
          rootFolderId: folderId,
          rootFolderUrl: driveUrl.trim(),
          archiveFolderId: archiveId,
          configuredBy: userId,
        });
      }

      onConfigured();
      onClose();
    } catch (err) {
      console.error('Drive setup error:', err);
      setError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect Google Drive" maxWidth="md">
      <div className="space-y-6">
        {/* Instructions */}
        <div className="text-sm text-muted-foreground space-y-3">
          <p>Connect a Google Drive folder to manage files for this project.</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
              <span>Open Google Drive and navigate to the folder you want to use</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
              <span>Copy the folder URL from your browser&apos;s address bar</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
              <span>Paste it below and click Connect</span>
            </div>
          </div>
        </div>

        {/* Drive Folder URL */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" />
            Google Drive Folder URL
          </label>
          <input
            type="text"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {driveUrl && (
            <p className={`text-xs mt-1.5 ${folderId ? 'text-green-400' : 'text-red-400'}`}>
              {folderId ? `Folder ID detected: ${folderId.slice(0, 20)}...` : 'Could not extract folder ID from URL'}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            isLoading={saving}
            disabled={!folderId}
          >
            Connect Drive
          </Button>
        </div>
      </div>
    </Modal>
  );
}
