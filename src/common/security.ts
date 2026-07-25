import { createHmac, timingSafeEqual } from 'node:crypto';

export function secretMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

function normalizedHostname(value: string): string | null {
  try {
    const url = new URL(`http://${value}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function hostAllowed(
  hostHeader: string | undefined,
  allowedHosts: readonly string[]
): boolean {
  if (!hostHeader) return false;
  const candidate = normalizedHostname(hostHeader);
  if (!candidate) return false;
  return allowedHosts.some((allowed) => {
    const normalized = normalizedHostname(allowed);
    return normalized !== null && normalized === candidate;
  });
}

export function signForm(secret: string, proposalId: string, createdAt: string, action: string): string {
  return createHmac('sha256', secret)
    .update(`${proposalId}\0${createdAt}\0${action}`)
    .digest('hex');
}

export function verifyFormSignature(
  candidate: unknown,
  secret: string,
  proposalId: string,
  createdAt: string,
  action: string
): boolean {
  return secretMatches(candidate, signForm(secret, proposalId, createdAt, action));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
