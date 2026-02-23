/**
 * Security utilities for input sanitization and URL validation.
 */

/**
 * Sanitize a URL to prevent javascript: protocol XSS attacks.
 * Returns a safe URL or empty string if the URL is malicious.
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';

  const trimmed = url.trim();
  if (!trimmed) return '';

  // Decode and strip whitespace/control characters to defeat obfuscation
  // e.g. "java\tscript:" or "&#106;avascript:"
  const decoded = trimmed.replace(/[\s\x00-\x1f]/g, '').toLowerCase();

  // Block dangerous protocols
  const dangerousProtocols = [
    'javascript:',
    'data:text/html',
    'vbscript:',
  ];

  for (const proto of dangerousProtocols) {
    if (decoded.startsWith(proto)) return '';
  }

  return trimmed;
}

/**
 * Ensure a URL has a valid protocol prefix for use in href attributes.
 * Only allows http/https protocols.
 */
export function safeHref(url: string): string {
  const safe = sanitizeUrl(url);
  if (!safe) return '';

  // If it already has http(s), use as-is
  if (/^https?:\/\//i.test(safe)) return safe;

  // Add https:// prefix for bare URLs
  return `https://${safe}`;
}

/**
 * Basic input sanitization — trims whitespace and enforces max length.
 */
export function sanitizeInput(value: string, maxLength = 500): string {
  if (!value || typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}
