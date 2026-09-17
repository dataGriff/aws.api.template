import { Pool, type PoolConfig } from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { getConfig } from "../config.js";
import { logger } from "../observability.js";

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

async function buildConfig(): Promise<PoolConfig> {
  const cfg = getConfig();
  if (cfg.DATABASE_URL) {
    return { connectionString: cfg.DATABASE_URL, max: 5 };
  }

  const host = cfg.DB_HOST;
  if (!host) throw new Error("DB_HOST or DATABASE_URL must be set");

  // TLS is required for RDS Proxy. Load the Amazon RDS CA bundle via
  // NODE_EXTRA_CA_CERTS so the chain verifies (rejectUnauthorized stays true).
  const ssl = cfg.DB_SSL ? { rejectUnauthorized: true } : false;

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
    const secret = await getSecret<{ password: string; username?: string }>(cfg.DB_SECRET_ARN, {
      transform: "json",
      maxAge: 300,
    });
    base.password = secret?.password;
    if (secret?.username) base.user = secret.username;
  }

  return base;
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  pool = new Pool(await buildConfig());
  pool.on("error", (err) => logger.error("Idle pg client error", { error: err.message }));
  return pool;
}

// Convenience query helper.
export async function query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const p = await getPool();
  const result = await p.query(text, params as unknown[]);
  return result.rows as T[];
}
