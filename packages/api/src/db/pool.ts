import { readFileSync } from "node:fs";
import pg, { Pool, type PoolConfig } from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { getConfig } from "../config.js";
import { logger } from "../observability.js";

// Return `date` columns (OID 1082) as the raw "YYYY-MM-DD" string. node-postgres
// would otherwise build a JS Date at *local* midnight, which shifts the day on
// any process whose TZ is not UTC (developer machines, some CI runners).
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

// A single Pool is cached at module scope and reused across warm invocations.
// Keep it small so RDS Proxy can multiplex effectively, and never hold session
// state that would pin a connection (no SET, temp tables, or session prepared
// statements) — pinning silently disables pooling.
let pool: Pool | undefined;

// RDS Proxy IAM auth tokens are valid for 15 minutes; cache and refresh early.
let tokenCache: { value: string; expiresAt: number } | undefined;
const TOKEN_TTL_MS = 13 * 60 * 1000;

async function iamToken(host: string, port: number, user: string, region: string) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.value;
  const signer = new Signer({ hostname: host, port, username: user, region });
  const value = await signer.getAuthToken();
  tokenCache = { value, expiresAt: now + TOKEN_TTL_MS };
  return value;
}

type DbSecret = { password: string; username?: string };

// Resolved per new connection (not once per pool) so a rotated secret is picked
// up without a cold start. Powertools caches the value for `maxAge` seconds.
const secretPassword = (arn: string) => async (): Promise<string> => {
  const secret = await getSecret<DbSecret>(arn, { transform: "json", maxAge: 300 });
  if (!secret?.password) throw new Error("DB secret has no password field");
  return secret.password;
};

async function buildConfig(): Promise<PoolConfig> {
  const cfg = getConfig();
  if (cfg.DATABASE_URL) {
    return { connectionString: cfg.DATABASE_URL, max: 5 };
  }

  const host = cfg.DB_HOST;
  if (!host) throw new Error("DB_HOST or DATABASE_URL must be set");

  // TLS with full verification. Modern RDS / RDS Proxy certificates chain to
  // Amazon roots that Node already trusts, so no extra CA is needed. For older
  // RDS CAs, point DB_CA_PATH at the Amazon RDS global CA bundle bundled into
  // the artifact and it is trusted in addition to the built-in roots.
  const ssl: PoolConfig["ssl"] = cfg.DB_SSL
    ? {
        rejectUnauthorized: true,
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-provided CA path, not user input
        ...(cfg.DB_CA_PATH ? { ca: readFileSync(cfg.DB_CA_PATH, "utf8") } : {}),
      }
    : false;

  const base: PoolConfig = {
    host,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    ssl,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  if (cfg.DB_IAM_AUTH) {
    // password is resolved per new connection so tokens stay fresh.
    base.password = () => iamToken(host, cfg.DB_PORT, cfg.DB_USER, cfg.AWS_REGION);
  } else if (cfg.DB_SECRET_ARN) {
    const secret = await getSecret<DbSecret>(cfg.DB_SECRET_ARN, { transform: "json", maxAge: 300 });
    if (secret?.username) base.user = secret.username;
    base.password = secretPassword(cfg.DB_SECRET_ARN);
  }

  return base;
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  pool = new Pool(await buildConfig());
  pool.on("error", (err) => logger.error("Idle pg client error", { error: err.message }));
  return pool;
}

// Test/shutdown helper — closes and clears the cached pool.
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// Convenience query helper.
export async function query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const p = await getPool();
  const result = await p.query(text, params as unknown[]);
  return result.rows as T[];
}
