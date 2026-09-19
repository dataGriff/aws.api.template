import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The deployed-only branches of db/pool.ts (IAM tokens, Secrets Manager
// password refresh, TLS options) never run in the container-backed suites,
// which use DATABASE_URL. Exercise them with the SDK and pg mocked.
const poolCtor = vi.fn();
vi.mock("pg", () => {
  class Pool {
    on = vi.fn();
    end = vi.fn(async () => {});
    constructor(config: unknown) {
      poolCtor(config);
    }
  }
  return { default: { types: { setTypeParser: vi.fn() } }, Pool };
});
const getAuthToken = vi.fn(async () => "iam-token-1");
vi.mock("@aws-sdk/rds-signer", () => ({
  Signer: class {
    getAuthToken = getAuthToken;
  },
}));
const getSecret = vi.fn();
vi.mock("@aws-lambda-powertools/parameters/secrets", () => ({ getSecret }));
vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => "-----BEGIN CERTIFICATE-----") }));

type PoolConfig = {
  connectionString?: string;
  host?: string;
  user?: string;
  ssl?: false | { rejectUnauthorized: boolean; ca?: string };
  password?: string | (() => Promise<string>);
  max?: number;
};

const ENV_KEYS = [
  "DATABASE_URL",
  "DB_HOST",
  "DB_USER",
  "DB_SSL",
  "DB_CA_PATH",
  "DB_IAM_AUTH",
  "DB_SECRET_ARN",
  "AWS_REGION",
];

async function poolWith(env: Record<string, string>): Promise<PoolConfig> {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  const { resetConfig } = await import("../../src/config.js");
  resetConfig();
  const { getPool } = await import("../../src/db/pool.js");
  await getPool();
  return poolCtor.mock.lastCall?.[0] as PoolConfig;
}

beforeEach(() => {
  poolCtor.mockClear();
  getAuthToken.mockClear();
  getSecret.mockReset();
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("db/pool configuration", () => {
  it("uses DATABASE_URL verbatim locally", async () => {
    const cfg = await poolWith({ DATABASE_URL: "postgresql://app:app@localhost:5432/app" });
    expect(cfg.connectionString).toBe("postgresql://app:app@localhost:5432/app");
    expect(cfg.max).toBe(5);
  });

  it("fails fast when neither DATABASE_URL nor DB_HOST is set", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
    const { resetConfig } = await import("../../src/config.js");
    resetConfig();
    const { getPool } = await import("../../src/db/pool.js");
    await expect(getPool()).rejects.toThrow(/DB_HOST or DATABASE_URL/);
  });

  it("verifies TLS and trusts an extra CA bundle when DB_CA_PATH is set", async () => {
    const cfg = await poolWith({
      DB_HOST: "proxy.internal",
      DB_SSL: "true",
      DB_CA_PATH: "/var/task/rds.pem",
    });
    expect(cfg.ssl).toMatchObject({ rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----" });
    expect(cfg.max).toBe(2);
  });

  it("mints an RDS IAM token per new connection and caches it within the TTL", async () => {
    const cfg = await poolWith({
      DB_HOST: "proxy.internal",
      DB_IAM_AUTH: "true",
      AWS_REGION: "eu-west-2",
    });
    expect(typeof cfg.password).toBe("function");
    const pw = cfg.password as () => Promise<string>;
    expect(await pw()).toBe("iam-token-1");
    expect(await pw()).toBe("iam-token-1");
    expect(getAuthToken).toHaveBeenCalledTimes(1);
  });

  it("re-reads the Secrets Manager password on every new connection (rotation-safe)", async () => {
    getSecret.mockResolvedValueOnce({ username: "rotated_user", password: "p1" });
    const cfg = await poolWith({
      DB_HOST: "db.internal",
      DB_SECRET_ARN: "arn:aws:secretsmanager:eu-west-2:123:secret:db",
    });
    expect(cfg.user).toBe("rotated_user");
    expect(typeof cfg.password).toBe("function");
    getSecret.mockResolvedValueOnce({ password: "p2" }).mockResolvedValueOnce({ password: "p3" });
    const pw = cfg.password as () => Promise<string>;
    expect(await pw()).toBe("p2");
    expect(await pw()).toBe("p3");
    expect(getSecret).toHaveBeenCalledTimes(3);
  });

  it("rejects a secret without a password field", async () => {
    getSecret.mockResolvedValueOnce({ username: "x", password: "p" });
    const cfg = await poolWith({
      DB_HOST: "db.internal",
      DB_SECRET_ARN: "arn:aws:secretsmanager:eu-west-2:123:secret:db",
    });
    getSecret.mockResolvedValueOnce({ username: "x" });
    await expect((cfg.password as () => Promise<string>)()).rejects.toThrow(/no password/);
  });
});
