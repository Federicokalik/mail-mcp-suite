import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type CloudflareAccessOptions = {
  teamDomain: string;
  audience: string;
  allowedEmails: readonly string[];
};

const jwksByTeamDomain = new Map<string, JWTVerifyGetKey>();

function normalizedTeamDomain(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an HTTPS origin without a path.'
    );
  }
  return url.origin;
}

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) return existing;

  const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
  jwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

export async function verifyCloudflareAccessJwt(
  assertion: string | undefined,
  options: CloudflareAccessOptions
): Promise<boolean> {
  if (!assertion) return false;

  try {
    const teamDomain = normalizedTeamDomain(options.teamDomain);
    const { payload } = await jwtVerify(assertion, remoteJwks(teamDomain), {
      issuer: teamDomain,
      audience: options.audience
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    return options.allowedEmails.some((allowed) => allowed.toLowerCase() === email);
  } catch {
    return false;
  }
}
