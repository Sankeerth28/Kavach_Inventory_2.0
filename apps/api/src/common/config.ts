/** Environment configuration. Secrets come from the environment only (PRD §25.2). */
export interface AppConfig {
  jwtSecret: Uint8Array;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  webOrigins: string[];
  cookieSecure: boolean;
  /** Path of the refresh cookie as the browser sees it (prefixed when the web app proxies the API). */
  cookiePath: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters.');
  }
  const webOrigins = (env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (env.NODE_ENV === 'production') {
    // PRD §25.2 HTTPS: refuse to start a production API that would send the session over HTTP.
    if (env.COOKIE_SECURE !== 'true') {
      throw new Error('In production COOKIE_SECURE must be true (serve the API over HTTPS).');
    }
    const plain = webOrigins.filter((o) => !o.startsWith('https://'));
    if (plain.length > 0) {
      throw new Error(`In production every WEB_ORIGIN must be https:// (got ${plain.join(', ')}).`);
    }
  }
  return {
    jwtSecret: new TextEncoder().encode(secret),
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlDays: 30,
    webOrigins,
    cookieSecure: env.COOKIE_SECURE === 'true',
    cookiePath: env.COOKIE_PATH?.trim() || '/auth',
  };
}
