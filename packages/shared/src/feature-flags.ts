/**
 * PRD v2.1 feature flags, the environment they need, and the per-project business settings
 * (change spec §0.2 and §1.1, docs/ENV_SETUP.md).
 *
 * Isomorphic and I/O-free: callers pass `process.env` and `projects.settings`. The database-backed
 * lookup with caching lives in `@kavach/db` (`FeatureFlags`).
 *
 * With every flag off nothing here is required, so a v2.0 deployment starts unchanged.
 */

export const FEATURE_FLAGS = [
  'requisition_enabled',
  'mr_required_for_issue',
  'control_enabled',
  'indents_enabled',
  'tool_custody_enabled',
  'whatsapp_enabled',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** `requisition_enabled` → `FEATURE_REQUISITION_ENABLED`. */
export function featureEnvName(flag: FeatureFlag): string {
  return `FEATURE_${flag.toUpperCase()}`;
}

/**
 * A flag only takes effect when its parent is also on. Blocking Material Out without an MR makes
 * no sense while MRs do not exist; WhatsApp alerts are requisition notifications.
 */
export const FEATURE_PARENT: Partial<Record<FeatureFlag, FeatureFlag>> = {
  mr_required_for_issue: 'requisition_enabled',
  whatsapp_enabled: 'requisition_enabled',
};

/** Environment variables that must be set when a flag is on (by env default or for any project). */
export const FEATURE_REQUIRED_ENV: Record<FeatureFlag, readonly string[]> = {
  requisition_enabled: [
    'JOBS_ENABLED',
    'SE_PWA_URL',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'SMTP_HOST',
    'SMTP_FROM',
  ],
  mr_required_for_issue: [],
  control_enabled: [],
  indents_enabled: [],
  tool_custody_enabled: [],
  whatsapp_enabled: ['WHATSAPP_BASE_URL', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
};

type Env = Record<string, string | undefined>;

export class FeatureConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureConfigError';
  }
}

const blank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

function parseBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new FeatureConfigError(`${name} must be "true" or "false" (got "${env[name]}").`);
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isUrl(v: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

/** Env defaults for every flag. All default to off. */
export function parseFeatureDefaults(env: Env): Record<FeatureFlag, boolean> {
  return Object.fromEntries(
    FEATURE_FLAGS.map((f) => [f, parseBool(env, featureEnvName(f), false)]),
  ) as Record<FeatureFlag, boolean>;
}

/** Applies FEATURE_PARENT: a child flag is off whenever its parent is off. */
export function resolveFlags(raw: Record<FeatureFlag, boolean>): Record<FeatureFlag, boolean> {
  const out = { ...raw };
  for (const f of FEATURE_FLAGS) {
    const parent = FEATURE_PARENT[f];
    if (parent && !out[parent]) out[f] = false;
  }
  return out;
}

/** Variables required by the given flags that are missing from the environment. */
export function missingFeatureEnv(env: Env, flags: Iterable<FeatureFlag>): string[] {
  const missing = new Set<string>();
  for (const f of flags) {
    for (const name of FEATURE_REQUIRED_ENV[f]) if (blank(env[name])) missing.add(name);
  }
  return [...missing];
}

/** Throws a message naming every missing variable and the flag that needs it. */
export function assertFeatureEnv(env: Env, flags: Iterable<FeatureFlag>, context = ''): void {
  const problems: string[] = [];
  for (const f of flags) {
    const names = FEATURE_REQUIRED_ENV[f].filter((n) => blank(env[n]));
    if (names.length > 0) problems.push(`${names.join(', ')} (needed by ${f}${context})`);
  }
  if (problems.length > 0) {
    throw new FeatureConfigError(
      `Missing required environment variable(s): ${problems.join('; ')}. ` +
        'Set them in .env (see .env.example and docs/ENV_SETUP.md) or turn the feature off.',
    );
  }
}

/** Configuration of the v2.1 features. Values that are not set are null. */
export interface FeatureEnvConfig {
  defaults: Record<FeatureFlag, boolean>;
  jobs: { enabled: boolean; timezone: string };
  sePwaUrl: string | null;
  photoMaxMb: number;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  smtp: {
    host: string;
    port: number;
    user: string | null;
    password: string | null;
    from: string;
  } | null;
  whatsapp: {
    baseUrl: string;
    accessToken: string;
    phoneNumberId: string;
    templateLang: string;
  } | null;
}

/**
 * Reads and validates the v2.1 environment. Fails fast (FeatureConfigError) when a variable needed
 * by a flag that is on by default is missing, or when any variable that is set is malformed.
 * Per-project overrides are checked separately against the database at startup.
 */
export function loadFeatureEnv(env: Env): FeatureEnvConfig {
  const defaults = parseFeatureDefaults(env);
  const effective = resolveFlags(defaults);
  assertFeatureEnv(
    env,
    FEATURE_FLAGS.filter((f) => effective[f]),
    ', turned on by its FEATURE_* variable',
  );
  const v = (name: string): string | null => (blank(env[name]) ? null : env[name]!.trim());
  const prod = env.NODE_ENV === 'production';

  const timezone = v('JOBS_TIMEZONE') ?? 'Asia/Kolkata';
  if (!isTimeZone(timezone)) {
    throw new FeatureConfigError(`JOBS_TIMEZONE "${timezone}" is not a valid IANA time zone.`);
  }

  const sePwaUrl = v('SE_PWA_URL');
  if (sePwaUrl && !isUrl(sePwaUrl, prod ? ['https:'] : ['https:', 'http:'])) {
    throw new FeatureConfigError(
      `SE_PWA_URL must be a full ${prod ? 'https://' : 'http(s)://'} URL (got "${sePwaUrl}").`,
    );
  }

  const photoMaxMb = Number(v('PHOTO_MAX_MB') ?? 5);
  if (!Number.isFinite(photoMaxMb) || photoMaxMb < 1 || photoMaxMb > 15) {
    throw new FeatureConfigError(
      `PHOTO_MAX_MB must be a number from 1 to 15 (got "${env.PHOTO_MAX_MB}").`,
    );
  }

  const vapidSubject = v('VAPID_SUBJECT');
  if (vapidSubject && !/^(mailto:|https:\/\/)/.test(vapidSubject)) {
    throw new FeatureConfigError('VAPID_SUBJECT must start with "mailto:" or "https://".');
  }
  const vapid =
    v('VAPID_PUBLIC_KEY') && v('VAPID_PRIVATE_KEY') && vapidSubject
      ? {
          publicKey: v('VAPID_PUBLIC_KEY')!,
          privateKey: v('VAPID_PRIVATE_KEY')!,
          subject: vapidSubject,
        }
      : null;

  const smtpPort = Number(v('SMTP_PORT') ?? 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new FeatureConfigError(`SMTP_PORT must be a port number (got "${env.SMTP_PORT}").`);
  }
  if (Boolean(v('SMTP_USER')) !== Boolean(v('SMTP_PASSWORD'))) {
    throw new FeatureConfigError('Set both SMTP_USER and SMTP_PASSWORD, or neither.');
  }
  const smtp =
    v('SMTP_HOST') && v('SMTP_FROM')
      ? {
          host: v('SMTP_HOST')!,
          port: smtpPort,
          user: v('SMTP_USER'),
          password: v('SMTP_PASSWORD'),
          from: v('SMTP_FROM')!,
        }
      : null;

  const waBase = v('WHATSAPP_BASE_URL');
  if (waBase && !isUrl(waBase, ['https:'])) {
    throw new FeatureConfigError(`WHATSAPP_BASE_URL must be an https:// URL (got "${waBase}").`);
  }
  const whatsapp =
    waBase && v('WHATSAPP_ACCESS_TOKEN') && v('WHATSAPP_PHONE_NUMBER_ID')
      ? {
          baseUrl: waBase,
          accessToken: v('WHATSAPP_ACCESS_TOKEN')!,
          phoneNumberId: v('WHATSAPP_PHONE_NUMBER_ID')!,
          templateLang: v('WHATSAPP_TEMPLATE_LANG') ?? 'en',
        }
      : null;

  return {
    defaults,
    jobs: { enabled: parseBool(env, 'JOBS_ENABLED', false), timezone },
    sePwaUrl,
    photoMaxMb,
    vapid,
    smtp,
    whatsapp,
  };
}

// ───────────────────── Per-project settings (projects.settings JSON) ─────────────────────

/** Per-project flag overrides: `projects.settings.features`. A missing key means "use the env default". */
export function parseFeatureOverrides(raw: unknown): Partial<Record<FeatureFlag, boolean>> {
  const features =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>).features : undefined;
  if (!features || typeof features !== 'object') return {};
  const out: Partial<Record<FeatureFlag, boolean>> = {};
  for (const f of FEATURE_FLAGS) {
    const v = (features as Record<string, unknown>)[f];
    if (typeof v === 'boolean') out[f] = v;
  }
  return out;
}

export type SeStockVisibility = 'status' | 'quantity';

/** Business rules editable by the Project Admin (change spec §1.1, ENV_SETUP §3). */
export interface BusinessSettings {
  buffer_days: number;
  mr_expiry_days: number;
  ack_overdue_hours: number;
  emergency_regularise_hours: number;
  emergency_rate_threshold_pct: number;
  return_request_overdue_days: number;
  se_stock_visibility: SeStockVisibility;
}

export const DEFAULT_BUSINESS_SETTINGS: Readonly<BusinessSettings> = Object.freeze({
  buffer_days: 7,
  mr_expiry_days: 3,
  ack_overdue_hours: 24,
  emergency_regularise_hours: 24,
  emergency_rate_threshold_pct: 10,
  return_request_overdue_days: 3,
  se_stock_visibility: 'status',
});

/** Inclusive bounds for the numeric settings. */
export const BUSINESS_SETTING_LIMITS: Record<
  Exclude<keyof BusinessSettings, 'se_stock_visibility'>,
  [number, number]
> = {
  buffer_days: [0, 90],
  mr_expiry_days: [1, 30],
  ack_overdue_hours: [1, 168],
  emergency_regularise_hours: [1, 168],
  emergency_rate_threshold_pct: [0, 100],
  return_request_overdue_days: [1, 30],
};

/**
 * Reads the business settings key by key from `projects.settings`. A missing or invalid key falls
 * back to its own default without affecting the others (or the v2.0 `confidence` key).
 */
export function parseBusinessSettings(raw: unknown): BusinessSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: BusinessSettings = { ...DEFAULT_BUSINESS_SETTINGS };
  for (const [key, [min, max]] of Object.entries(BUSINESS_SETTING_LIMITS)) {
    const v = src[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) {
      (out as unknown as Record<string, number>)[key] = v;
    }
  }
  if (src.se_stock_visibility === 'status' || src.se_stock_visibility === 'quantity') {
    out.se_stock_visibility = src.se_stock_visibility;
  }
  return out;
}
