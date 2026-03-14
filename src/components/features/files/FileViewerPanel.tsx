'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { FileText, ExternalLink, Download, Eye, Loader2 } from 'lucide-react';
import mammoth from 'mammoth';
import { Button } from '@/components/shared/Button';
import {
  getDriveFileContent,
  getDriveFileBinary,
  exportGoogleDocAsHtml,
  convertOfficeToPdf,
  getDriveFileThumbnail,
} from '@/lib/db/files';
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

type PreviewType = 'text' | 'html' | 'pdf' | 'image' | 'video' | null;

// ── Props ────────────────────────────────────────────────────────────────────

interface FileViewerPanelProps {
  file: DriveItem | null;
  projectId: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function FileViewerPanel({ file, projectId }: FileViewerPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<PreviewType>(null);
  const [loading, setLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    setContent(null);
    setPreviewType(null);
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

      // Office slide/sheet files → convert to PDF server-side
      if (isOfficeSlideSheet(mime)) {
        const pdfBlobUrl = await convertOfficeToPdf(projectId, f.id, mime!);
        if (pdfBlobUrl) {
          blobUrlRef.current = pdfBlobUrl;
          setBlobUrl(pdfBlobUrl);
          setPreviewType('pdf');
        } else {
          // Fallback: try thumbnail
          const thumbUrl = await getDriveFileThumbnail(projectId, f.id);
          if (thumbUrl) {
            blobUrlRef.current = thumbUrl;
            setBlobUrl(thumbUrl);
            setPreviewType('image');
          }
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

      // Google Workspace docs → export as HTML
      if (isGoogleDoc(mime)) {
        const html = await exportGoogleDocAsHtml(projectId, f.id);
        if (html) {
          setContent(html);
          setPreviewType('html');
        }
        return;
      }

      // Word docs (.docx/.doc) → download binary, convert to HTML with mammoth
      if (isWordDoc(mime)) {
        const result = await getDriveFileBinary(projectId, f.id);
        if (result) {
          const response = await fetch(result.blobUrl);
          const arrayBuffer = await response.arrayBuffer();
          URL.revokeObjectURL(result.blobUrl);
          const mammothResult = await mammoth.convertToHtml({ arrayBuffer });
          setContent(mammothResult.value);
          setPreviewType('html');
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
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground font-medium">Loading preview...</p>
          </div>
        ) : previewType === 'html' && content ? (
          /* Google Docs / Word docs exported as HTML */
          <div className="h-full overflow-auto bg-white">
            <div
              className="prose prose-sm max-w-none p-6 text-black [&_a]:text-blue-600"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </div>
        ) : previewType === 'pdf' && blobUrl ? (
          /* PDF rendered from blob */
          <iframe
            src={blobUrl}
            className="h-full w-full border-0"
            title={file.name}
          />
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
