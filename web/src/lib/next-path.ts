/** Where to go after signing in: only same-site app paths, never another origin. */
export function safeNextPath(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw.startsWith('/app') ? raw : fallback;
}
