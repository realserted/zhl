'use client';

import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { FolderOpen, Link as LinkIcon, Key, Copy, ExternalLink } from 'lucide-react';
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

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  for (const byte of array) {
    result += chars[byte % chars.length];
  }
  return result;
}

export default function DriveSetupModal({ isOpen, onClose, projectId, userId, onConfigured }: DriveSetupModalProps) {
  const [driveUrl, setDriveUrl] = useState('');
  const [appsScriptUrl, setAppsScriptUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderId = extractFolderId(driveUrl);

  const handleGenerateKey = () => {
    const key = generateApiKey();
    setApiKey(key);
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiKey);
  };

  const handleSave = async () => {
    setError(null);

    if (!folderId) {
      setError('Could not extract a valid folder ID from the URL.');
      return;
    }
    if (!appsScriptUrl.trim()) {
      setError('Please enter the Apps Script web app URL.');
      return;
    }
    if (!apiKey.trim()) {
      setError('Please enter or generate an API key.');
      return;
    }

    // Validate Apps Script URL format
    if (!appsScriptUrl.includes('script.google.com') && !appsScriptUrl.includes('googleusercontent.com')) {
      setError('The Apps Script URL should be from script.google.com or googleusercontent.com.');
      return;
    }

    setSaving(true);

    try {
      // Save the config
      const config = await upsertDriveConfig({
        projectId,
        rootFolderId: folderId,
        rootFolderUrl: driveUrl.trim(),
        appsScriptUrl: appsScriptUrl.trim(),
        appsScriptApiKey: apiKey.trim(),
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
        // Update the config with the archive folder ID
        await upsertDriveConfig({
          projectId,
          rootFolderId: folderId,
          rootFolderUrl: driveUrl.trim(),
          appsScriptUrl: appsScriptUrl.trim(),
          appsScriptApiKey: apiKey.trim(),
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
    <Modal isOpen={isOpen} onClose={onClose} title="Connect Google Drive" maxWidth="lg">
      <div className="space-y-6">
        {/* Instructions */}
        <div className="text-sm text-muted-foreground space-y-2">
          <p>Connect a Google Drive folder to manage files for this project.</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Share a Google Drive folder with your project team</li>
            <li>
              Deploy the ZHL Apps Script —{' '}
              <a
                href="https://script.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Open Apps Script <ExternalLink className="h-3 w-3" />
              </a>
            </li>
            <li>Set the API Key in Script Properties and deploy as a Web App</li>
            <li>Paste the details below</li>
          </ol>
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
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {driveUrl && (
            <p className={`text-xs mt-1 ${folderId ? 'text-green-400' : 'text-red-400'}`}>
              {folderId ? `Folder ID: ${folderId}` : 'Could not extract folder ID from URL'}
            </p>
          )}
        </div>

        {/* Apps Script URL */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <LinkIcon className="h-3.5 w-3.5 inline mr-1.5" />
            Apps Script Web App URL
          </label>
          <input
            type="text"
            value={appsScriptUrl}
            onChange={(e) => setAppsScriptUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <Key className="h-3.5 w-3.5 inline mr-1.5" />
            API Key
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Shared secret between ZHL and Apps Script"
              className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button variant="outline" size="sm" onClick={handleGenerateKey}>
              Generate
            </Button>
            {apiKey && (
              <Button variant="ghost" size="icon" onClick={handleCopyKey} title="Copy API Key">
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
          {apiKey && (
            <p className="text-xs text-amber-400 mt-1">
              Copy this key and add it as &quot;API_KEY&quot; in your Apps Script&apos;s Script Properties.
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
            disabled={!folderId || !appsScriptUrl.trim() || !apiKey.trim()}
          >
            Connect Drive
          </Button>
        </div>
      </div>
    </Modal>
  );
}
