const REQUIRED_ENV_VARS = ['NOSANA_API_KEY', 'NOSANA_JOB_TEMPLATE'] as const;
const TEMPLATE_REQUIRED_FIELDS = [
  'name',
  'market',
  'strategy',
  'replicas',
  'timeout',
  'job_definition',
] as const;

function readEnv(key: string): string {
  return process.env[key]?.trim() || '';
}

function validateJobTemplate(rawTemplate: string): string[] {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTemplate);
  } catch {
    return ['NOSANA_JOB_TEMPLATE must be valid JSON'];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['NOSANA_JOB_TEMPLATE must be a JSON object'];
  }

  const template = parsed as Record<string, unknown>;
  const missing = TEMPLATE_REQUIRED_FIELDS.filter((field) => {
    const value = template[field];
    if (typeof value === 'string') return value.trim().length === 0;
    return value === undefined || value === null;
  });

  if (missing.length > 0) {
    errors.push(`NOSANA_JOB_TEMPLATE missing required fields: ${missing.join(', ')}`);
  }

  return errors;
}

/**
 * Returns the required Nosana API key and throws when it is absent.
 *
 * @returns Non-empty Nosana API key string.
 * @example
 * const apiKey = getRequiredNosanaApiKey();
 */
export function getRequiredNosanaApiKey(): string {
  const apiKey = readEnv('NOSANA_API_KEY');
  if (!apiKey) {
    throw new Error('NOSANA_API_KEY is not set. Add it to your environment before using Nosana actions.');
  }
  return apiKey;
}

/**
 * Validates required runtime environment variables before the agent starts.
 *
 * @returns Throws an error when required values are missing or malformed.
 * @example
 * validateNosanaOpsStartupEnv();
 */
export function validateNosanaOpsStartupEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => readEnv(key) === '');
  const errors: string[] = [];

  if (missing.length > 0) {
    errors.push(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const templateRaw = readEnv('NOSANA_JOB_TEMPLATE');
  if (templateRaw) {
    errors.push(...validateJobTemplate(templateRaw));
  }

  const hasTelegramToken = readEnv('TELEGRAM_BOT_TOKEN') !== '';
  const hasTelegramChat = readEnv('TELEGRAM_CHAT_ID') !== '';
  if (hasTelegramToken !== hasTelegramChat) {
    console.warn(
      '[nosana:env] Telegram alerts are partially configured. Set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable proactive alerts.'
    );
  }

  if (errors.length > 0) {
    throw new Error(`NosanaScope environment validation failed:\n- ${errors.join('\n- ')}`);
  }
}
