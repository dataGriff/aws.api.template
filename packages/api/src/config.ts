import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

// Validate configuration once at cold start. Fail fast on misconfiguration.
const schema = z.object({
  APP_ENV: z.string().default("local"),
  AWS_REGION: z.string().default("eu-west-2"),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),

  // Database. Either a full DATABASE_URL (local) or discrete parts (deployed).
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default("app"),
  DB_USER: z.string().default("app"),
  DB_SSL: bool(false),
  // Optional path to a CA bundle (e.g. the Amazon RDS global bundle) trusted in
  // addition to Node's built-in roots.
  DB_CA_PATH: z.string().optional(),

  // When true, mint short-lived RDS Proxy IAM auth tokens instead of a password.
  DB_IAM_AUTH: bool(false),
  // Secrets Manager ARN holding the DB password (used when DB_IAM_AUTH is false
  // and no DATABASE_URL is provided).
  DB_SECRET_ARN: z.string().optional(),

  // DynamoDB table backing Powertools idempotency.
  IDEMPOTENCY_TABLE: z.string().optional(),
  // Optional endpoint override (DynamoDB Local in tests), like DATABASE_URL for Postgres.
  IDEMPOTENCY_ENDPOINT: z.string().url().optional(),

  // CSV import pipeline (POST /imports). The bucket receives pre-signed POST
  // uploads; objects must be encrypted with this CMK (enforced by the bucket
  // policy and by the signed upload conditions). Unset = imports disabled (503).
  IMPORT_BUCKET: z.string().optional(),
  IMPORT_KMS_KEY_ARN: z.string().optional(),
  // Optional S3 endpoint override (moto locally / in tests), like DATABASE_URL
  // for Postgres. Forces path-style addressing so bucket names need no DNS.
  AWS_ENDPOINT_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= schema.parse(process.env);
  return cached;
}

// Tests only: forget the cached snapshot so a changed process.env is re-read.
export function resetConfig(): void {
  cached = undefined;
}
