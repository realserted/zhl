'use client';

import { lazy, Suspense } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import DOMPurify from 'isomorphic-dompurify';

const PdfViewer = lazy(() => import('@/components/shared/PdfViewer'));

export interface FilePreviewData {
  url: string;
  name: string;
  htmlContent?: string;
  downloadUrl?: string;
  pdfData?: ArrayBuffer;
  /** MIME type from the API response (used for blob URLs). */
  contentType?: string;
  /** True while the file is being fetched. */
  loading?: boolean;
}

interface FilePreviewModalProps {
  preview: FilePreviewData | null;
  onClose: () => void;
}

/** Detect preview category from contentType or file name. */
function detectType(preview: FilePreviewData): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'html' | 'drive' | 'unknown' {
  const ct = preview.contentType ?? '';
  const name = preview.name.toLowerCase();

  // Google Drive fallback URL
  if (preview.url.includes('drive.google.com')) return 'drive';

  // Content-type based detection (blob URLs from API)
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'application/pdf') return 'pdf';
  if (ct.startsWith('text/html')) return 'html';
  if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml') return 'text';

  // Fallback to file extension
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name)) return 'image';
  if (/\.(mp4|webm|ogg|mov)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|aac|flac)$/i.test(name)) return 'audio';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(txt|csv|md|log)$/i.test(name)) return 'text';
  if (/\.html?$/i.test(name)) return 'html';

  return 'unknown';
}

export function FilePreviewModal({ preview, onClose }: FilePreviewModalProps) {
  if (!preview) return null;

  const type = preview.loading ? 'loading' : detectType(preview);
  const isDrive = type === 'drive';

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-background/95 border border-white/10 rounded-xl shadow-2xl flex flex-col w-full max-w-5xl animate-in fade-in zoom-in duration-200" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-sm font-bold tracking-tight truncate">{preview.name}</h3>
          <div className="flex items-center gap-2">
            {!preview.loading && preview.url && (
              <a
                href={preview.downloadUrl || preview.url}
                download={isDrive ? undefined : preview.name}
                target={isDrive ? '_blank' : undefined}
                rel={isDrive ? 'noopener noreferrer' : undefined}
                className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground hover:text-foreground border border-border/50 rounded-xl transition-all"
              >
                {isDrive ? 'Open in Drive' : 'Download'}
              </a>
            )}
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Preview content */}
        <div className="flex-1 overflow-hidden p-1">
          {type === 'loading' ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Loading preview...</p>
            </div>
          ) : isDrive ? (
            <iframe src={preview.url} className="w-full h-full rounded-lg border-0" title={preview.name} allow="autoplay" />
          ) : preview.htmlContent ? (
            <div className="w-full h-full overflow-auto bg-white rounded-lg p-8" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.htmlContent) }} style={{ color: '#222', fontSize: '14px', lineHeight: '1.6' }} />
          ) : type === 'image' ? (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={preview.name} className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          ) : type === 'video' ? (
            <video src={preview.url} controls className="w-full h-full object-contain rounded-lg" />
          ) : type === 'audio' ? (
            <div className="w-full h-full flex items-center justify-center">
              <audio src={preview.url} controls className="w-full max-w-md" />
            </div>
          ) : type === 'pdf' ? (
            preview.pdfData ? (
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>}>
                <PdfViewer data={preview.pdfData} />
              </Suspense>
            ) : (
              <object data={preview.url} type="application/pdf" className="w-full h-full rounded-lg">
                <iframe src={preview.url} className="w-full h-full rounded-lg border-0" title={preview.name} />
              </object>
            )
          ) : type === 'text' || type === 'html' ? (
            <iframe src={preview.url} className="w-full h-full rounded-lg border-0" title={preview.name} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <FileText className="h-16 w-16 opacity-30" />
              <p className="text-sm font-medium">Preview not available for this file type</p>
              {preview.url && (
                <a href={preview.url} download={preview.name} className="px-4 py-2 text-xs font-bold tracking-wider uppercase bg-primary text-primary-foreground rounded-xl transition-all hover:opacity-90">
                  Download to view
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
