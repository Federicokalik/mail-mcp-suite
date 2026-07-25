import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const boolish = z
  .string()
  .transform((value) => value === 'true' || value === '1')
  .pipe(z.boolean());

export const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string()));

export function parseEnvironment<Schema extends z.ZodTypeAny>(
  schema: Schema,
  source: NodeJS.ProcessEnv = process.env
): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data as z.infer<Schema>;

  const issues = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid configuration:\n${issues}`);
}

function withoutFinalNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

export function readSecret(name: string, minimumLength = 1): string {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) {
    throw new Error(`Configure only ${name} or ${name}_FILE, not both.`);
  }

  let value: string;
  if (file) {
    try {
      value = withoutFinalNewline(readFileSync(file, 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read ${name}_FILE: ${reason}`);
    }
  } else if (direct) {
    value = direct;
  } else {
    throw new Error(`Missing secret: configure ${name}_FILE (preferred) or ${name}.`);
  }

  if (value.length < minimumLength) {
    throw new Error(`${name} must contain at least ${minimumLength} characters.`);
  }
  return value;
}

export function assertEncryptedTransport(
  label: string,
  secure: boolean,
  allowInsecure: boolean
): void {
  if (!secure && !allowInsecure) {
    throw new Error(
      `${label}_SECURE=false is blocked. Set ALLOW_INSECURE_MAIL_TRANSPORT=true only on a test network.`
    );
  }
}
