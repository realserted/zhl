'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { FileText, ExternalLink, Download, Eye, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import {
  getDriveFileContent,
  getDriveFileBinary,
  getDriveFileArrayBuffer,
  importToGoogleFormat,
  updateDriveFileContent,
  updateDriveDocx,
  syncPdfEdit,
} from '@/lib/db/files';
import { CsvEditor } from './CsvEditor';
import { DocxEditor } from './DocxEditor';
import type { DriveItem } from '@/lib/types/files';

// ── MIME helpers ─────────────────────────────────────────────────────────────

const GOOGLE_DOC_MIMES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];

const WORD_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const OFFICE_SLIDE_SHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

function isGoogleDoc(mime: string | null) { return !!mime && GOOGLE_DOC_MIMES.includes(mime); }
function isPdf(mime: string | null) { return mime === 'application/pdf'; }
function isImage(mime: string | null) { return !!mime && mime.startsWith('image/'); }
function isVideo(mime: string | null) { return !!mime && mime.startsWith('video/'); }
function isWordDoc(mime: string | null) { return !!mime && WORD_MIMES.includes(mime); }
function isOfficeSlideSheet(mime: string | null) { return !!mime && OFFICE_SLIDE_SHEET_MIMES.includes(mime); }

function isText(mime: string | null) {
  if (!mime) return false;
  const textTypes = [
    'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'text/html', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript',
  ];
  return textTypes.includes(mime) || mime.startsWith('text/');
}

function isPreviewable(mime: string | null) {
  return isGoogleDoc(mime) || isPdf(mime) || isImage(mime) || isText(mime)
    || isVideo(mime) || isWordDoc(mime) || isOfficeSlideSheet(mime);
}

function isCsv(mime: string | null, name?: string) {
  if (mime === 'text/csv') return true;
  if (name && name.toLowerCase().endsWith('.csv')) return true;
  return false;
}

/** Build embedded Google editor URL */
function getGoogleEditorUrl(file: DriveItem, ownerEmail?: string | null): string | null {
  const mime = file.mimeType;
  if (!mime) return null;

  const authParam = ownerEmail ? `&authuser=${encodeURIComponent(ownerEmail)}` : '';

  // Native Google Workspace files — full editor UI
  if (mime === 'application/vnd.google-apps.document') {
    return `https://docs.google.com/document/d/${file.id}/edit?hl=en${authParam}`;
  }
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${file.id}/edit?hl=en${authParam}`;
  }
  if (mime === 'application/vnd.google-apps.presentation') {
    return `https://docs.google.com/presentation/d/${file.id}/edit?hl=en${authParam}`;
  }

  return null;
}

function hasGoogleEditor(file: DriveItem): boolean {
  return getGoogleEditorUrl(file) !== null || isCsv(file.mimeType, file.name) || isWordDoc(file.mimeType) || isOfficeSlideSheet(file.mimeType);
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Preview types ────────────────────────────────────────────────────────────

type PreviewType = 'text' | 'pdf' | 'image' | 'video' | 'drivePreview' | 'csv' | 'docx' | null;

// ── Props ────────────────────────────────────────────────────────────────────

interface FileViewerPanelProps {
  file: DriveItem | null;
  projectId: string;
  ownerEmail?: string | null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function FileViewerPanel({ file, projectId, ownerEmail }: FileViewerPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<PreviewType>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [importedEditorUrl, setImportedEditorUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [pdfEditDocId, setPdfEditDocId] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    setContent(null);
    setPreviewType(null);
    setImportedEditorUrl(null);
    setDocxHtml(null);
    setPdfEditDocId(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
  }, []);

  const fetchPreview = useCallback(async (f: DriveItem) => {
    setLoading(true);
    cleanup();

    try {
      const mime = f.mimeType;

      // Office slide/sheet files → convert to Google format and edit
      if (isOfficeSlideSheet(mime)) {
        const imported = await importToGoogleFormat(projectId, f.id, mime!, f.name);
        if (imported) {
          setImportedEditorUrl(imported.editorUrl);
          setEditMode(true);
        } else {
          setPreviewType('drivePreview');
        }
        return;
      }

      // Video → download binary, render in <video>
      if (isVideo(mime)) {
        const result = await getDriveFileBinary(projectId, f.id);
        if (result) {
          blobUrlRef.current = result.blobUrl;
          setBlobUrl(result.blobUrl);
          setPreviewType('video');
        }
        return;
      }

      // Google Workspace docs (Docs, Sheets, Slides) → open editor directly
      if (isGoogleDoc(mime)) {
        setPreviewType('drivePreview');
        setEditMode(true);
        return;
      }

      // Word docs (.docx/.doc) → inline rich text editor
      if (isWordDoc(mime)) {
        const arrayBuffer = await getDriveFileArrayBuffer(projectId, f.id);
        if (arrayBuffer) {
          const mammoth = (await import('mammoth')).default;
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(result.value);
          setPreviewType('docx');
        } else {
          setPreviewType('drivePreview');
        }
        return;
      }

      // PDFs → download binary, render in iframe
      if (isPdf(mime)) {
        const result = await getDriveFileBinary(projectId, f.id);
        if (result) {
          blobUrlRef.current = result.blobUrl;
          setBlobUrl(result.blobUrl);
          setPreviewType('pdf');
        }
        return;
      }

      // Images → download binary
      if (isImage(mime)) {
        const result = await getDriveFileBinary(projectId, f.id);
        if (result) {
          blobUrlRef.current = result.blobUrl;
          setBlobUrl(result.blobUrl);
          setPreviewType('image');
        }
        return;
      }

      // CSV files → inline CSV editor
      if (isCsv(mime, f.name)) {
        const text = await getDriveFileContent(projectId, f.id);
        if (text) {
          setContent(text);
          setPreviewType('csv');
        }
        return;
      }

      // Text files → get as text
      if (isText(mime)) {
        const text = await getDriveFileContent(projectId, f.id);
        if (text) {
          setContent(text);
          setPreviewType('text');
        }
        return;
      }
    } catch {
      // Failed to load preview
    } finally {
      setLoading(false);
    }
  }, [projectId, cleanup]);

  useEffect(() => {
    cleanup();
    setEditMode(false);
    if (file && isPreviewable(file.mimeType)) {
      fetchPreview(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-2xl bg-muted/30 p-4">
          <Eye className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          Select a file from the tree to preview it
        </p>
      </div>
    );
  }

  const mimeLabel = file.mimeType?.split('/').pop()?.split('.').pop() ?? 'file';

  return (
    <div className="flex h-full flex-col">
      {/* File info bar */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-3 overflow-hidden min-w-0">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-foreground">{file.name}</p>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {file.size ? <span>{formatBytes(file.size)}</span> : null}
              {file.size && file.modifiedTime ? <span>·</span> : null}
              {file.modifiedTime ? <span>{formatDate(file.modifiedTime)}</span> : null}
              <span className="px-1.5 py-0.5 rounded-md bg-muted/50 text-[10px] font-bold uppercase tracking-wider">
                {mimeLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isPdf(file.mimeType) && (
            editMode ? (
              <Button
                variant="primary"
                size="sm"
                className="gap-1.5 text-xs shadow-none"
                onClick={async () => {
                  const docId = pdfEditDocId;
                  // Unmount the iframe FIRST to avoid "Something went wrong" error
                  setEditMode(false);
                  setImportedEditorUrl(null);
                  // Then sync edits back: export Google Doc as PDF → overwrite original → delete copy
                  if (docId) {
                    setLoading(true);
                    const result = await syncPdfEdit(projectId, file.id, docId);
                    setPdfEditDocId(null);
                    // Use the PDF returned by syncPdfEdit directly (no second fetch needed)
                    if (result.blobUrl) {
                      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
                      blobUrlRef.current = result.blobUrl;
                      setBlobUrl(result.blobUrl);
                    }
                    setLoading(false);
                  }
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Save & Preview</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs shadow-none"
                onClick={async () => {
                  setLoading(true);
                  const imported = await importToGoogleFormat(projectId, file.id, file.mimeType!, file.name);
                  if (imported) {
                    setImportedEditorUrl(imported.editorUrl);
                    setPdfEditDocId(imported.googleFileId);
                    setEditMode(true);
                  }
                  setLoading(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            )
          )}
          {file.webContentLink && (
            <a href={file.webContentLink} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs shadow-none">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </a>
          )}
          {file.webViewLink && (
            <a href={file.webViewLink} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs shadow-none">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open in Drive</span>
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Preview content */}
      <div className="flex-1 overflow-hidden">
        {editMode && (importedEditorUrl || getGoogleEditorUrl(file, ownerEmail)) ? (
          /* Google embedded editor */
          <iframe
            src={importedEditorUrl || getGoogleEditorUrl(file, ownerEmail)!}
            className="h-full w-full border-0"
            title={`Edit ${file.name}`}
            allow="clipboard-read; clipboard-write"
          />
        ) : loading ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground font-medium">Loading preview...</p>
          </div>
        ) : previewType === 'pdf' && blobUrl ? (
          /* PDF rendered from blob */
          <object
            data={`${blobUrl}#toolbar=1&navpanes=1`}
            type="application/pdf"
            className="h-full w-full"
          >
            <iframe
              src={`${blobUrl}#toolbar=1`}
              className="h-full w-full border-0"
              title={file.name}
            />
          </object>
        ) : previewType === 'image' && blobUrl ? (
          /* Images rendered from blob */
          <div className="flex h-full items-center justify-center bg-muted/10 p-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blobUrl}
              alt={file.name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
            />
          </div>
        ) : previewType === 'video' && blobUrl ? (
          /* Video rendered from blob */
          <div className="flex h-full items-center justify-center bg-black p-4">
            <video
              src={blobUrl}
              controls
              className="max-h-full max-w-full rounded-lg"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        ) : previewType === 'drivePreview' ? (
          /* Google Drive embedded preview for CSV, DOCX, XLSX, PPTX */
          <iframe
            src={`https://drive.google.com/file/d/${file.id}/preview`}
            className="h-full w-full border-0"
            title={file.name}
            allow="autoplay"
          />
        ) : previewType === 'csv' && content && file ? (
          /* Inline CSV editor */
          <CsvEditor
            initialContent={content}
            onSave={async (csv) => updateDriveFileContent(projectId, file.id, csv, 'text/csv')}
          />
        ) : previewType === 'docx' && docxHtml !== null && file ? (
          /* Inline DOCX editor */
          <DocxEditor
            initialHtml={docxHtml}
            onSave={async (html) => updateDriveDocx(projectId, file.id, html)}
          />
        ) : previewType === 'text' && content ? (
          /* Text/code files */
          <div className="h-full overflow-auto">
            <pre className="whitespace-pre-wrap p-4 font-mono text-sm text-foreground">
              {content}
            </pre>
          </div>
        ) : (
          /* Unsupported format */
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-2xl bg-muted/30 p-4">
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Preview not available</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This file type can&apos;t be previewed.{' '}
                {file.webViewLink && 'Open it in Google Drive instead.'}
              </p>
            </div>
            {file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Google Drive
                </Button>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
