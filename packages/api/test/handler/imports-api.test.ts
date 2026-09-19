import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../../src/repo/imports-repo.js";
import { resetConfig } from "../../src/config.js";
import { resetAwsClients } from "../../src/aws.js";
import { invoke, parse } from "../helpers/invoke.js";

vi.mock("../../src/repo/imports-repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/repo/imports-repo.js")>();
  return { ...actual, create: vi.fn(), getById: vi.fn() };
});

const KEY_ARN = "arn:aws:kms:eu-west-2:123456789012:key/11111111-2222-3333-4444-555555555555";

const record = (over: Partial<repo.ImportRecord> = {}): repo.ImportRecord => ({
  import_id: "22222222-2222-4222-8222-222222222222",
  tenant_id: "tenant-1",
  user_sub: "user-1",
  object_key: "uploads/tenant-1/22222222-2222-4222-8222-222222222222.csv",
  file_name: "todos.csv",
  status: "awaiting_upload",
  row_count: null,
  created_count: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  completed_at: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  process.env.IMPORT_BUCKET = "imports-bucket";
  process.env.IMPORT_KMS_KEY_ARN = KEY_ARN;
  process.env.AWS_ENDPOINT_URL = "http://localhost:5000";
  process.env.AWS_ACCESS_KEY_ID = "local";
  process.env.AWS_SECRET_ACCESS_KEY = "local";
  resetConfig();
  resetAwsClients();
  vi.mocked(repo.create).mockImplementation(async (auth, input) =>
    record({
      import_id: input.importId,
      object_key: input.objectKey,
      file_name: input.fileName,
      tenant_id: auth.tenantId,
      user_sub: auth.userSub,
    }),
  );
});

type Created = {
  import_id: string;
  status: string;
  file_name: string;
  upload: { url: string; fields: Record<string, string>; expires_at: string; max_bytes: number };
};

describe("POST /imports — one-time pre-signed upload target", () => {
  it("registers the import for the caller and pins key, type, size and encryption in the signed policy", async () => {
    const res = await invoke({
      method: "POST",
      resource: "/imports",
      body: { file_name: "todos.csv" },
      claims: { sub: "alice", "custom:tenant_id": "acme" },
    });
    expect(res.statusCode).toBe(201);
    const body = parse(res) as Created;
    expect(body.status).toBe("awaiting_upload");
    expect(body.file_name).toBe("todos.csv");
    expect(res.headers?.location).toBe(`/v1/imports/${body.import_id}`);

    // The row is owned by the token's identity and points at the signed key.
    const [auth, input] = vi.mocked(repo.create).mock.calls[0]!;
    expect(auth).toMatchObject({ tenantId: "acme", userSub: "alice" });
    expect(input.objectKey).toBe(`uploads/acme/${body.import_id}.csv`);

    // Pre-signed POST: path-style URL to the bucket, fixed key and headers.
    expect(body.upload.url).toBe("http://localhost:5000/imports-bucket");
    expect(body.upload.fields.key).toBe(`uploads/acme/${body.import_id}.csv`);
    expect(body.upload.fields["Content-Type"]).toBe("text/csv");
    expect(body.upload.fields["x-amz-server-side-encryption"]).toBe("aws:kms");
    expect(body.upload.fields["x-amz-server-side-encryption-aws-kms-key-id"]).toBe(KEY_ARN);
    expect(body.upload.fields["X-Amz-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(body.upload.max_bytes).toBe(1048576);

    // The policy S3 enforces carries the same conditions the response advertises.
    const policy = JSON.parse(Buffer.from(body.upload.fields.Policy!, "base64").toString()) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 1048576]);
    expect(policy.conditions).toContainEqual({ key: `uploads/acme/${body.import_id}.csv` });
    expect(policy.conditions).toContainEqual({ "Content-Type": "text/csv" });
    expect(policy.conditions).toContainEqual({ "x-amz-server-side-encryption": "aws:kms" });
    expect(new Date(policy.expiration).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(new Date(body.upload.expires_at).getTime()).toBeLessThanOrEqual(
      new Date(policy.expiration).getTime() + 1000,
    );
  });

  it.each([
    [{}, "file_name"],
    [{ file_name: "../../etc/passwd" }, "file_name"],
    [{ file_name: "notes.txt" }, "file_name"],
    [{ file_name: "a.csv", extra: 1 }, "(root)"],
  ])("rejects body %j with 400 (contract: todo_import_create)", async (body, field) => {
    const res = await invoke({ method: "POST", resource: "/imports", body });
    expect(res.statusCode).toBe(400);
    expect((parse(res) as { errors: { field: string }[] }).errors[0]?.field).toBe(field);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("requires an authenticated caller", async () => {
    const res = await invoke({
      method: "POST",
      resource: "/imports",
      body: { file_name: "a.csv" },
      claims: null,
    });
    expect(res.statusCode).toBe(401);
  });

  it("is a 500, not a client error, when the bucket is not configured", async () => {
    delete process.env.IMPORT_BUCKET;
    resetConfig();
    const res = await invoke({
      method: "POST",
      resource: "/imports",
      body: { file_name: "a.csv" },
    });
    expect(res.statusCode).toBe(500);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("GET /imports/{import_id}", () => {
  it("returns the caller's import without owner or storage details", async () => {
    vi.mocked(repo.getById).mockResolvedValue(
      record({
        status: "rejected",
        row_count: 3,
        created_count: 0,
        errors: [{ row: 2, field: "status", message: "x" }],
      }),
    );
    const res = await invoke({
      method: "GET",
      resource: "/imports/{import_id}",
      pathParameters: { import_id: "22222222-2222-4222-8222-222222222222" },
    });
    expect(res.statusCode).toBe(200);
    const body = parse(res) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "rejected", row_count: 3, created_count: 0 });
    expect(body).not.toHaveProperty("object_key");
    expect(body).not.toHaveProperty("tenant_id");
    expect(body).not.toHaveProperty("user_sub");
    expect(body).not.toHaveProperty("upload");
  });

  it("is scoped by the token: the repository is queried with the caller's identity", async () => {
    vi.mocked(repo.getById).mockResolvedValue(null);
    const res = await invoke({
      method: "GET",
      resource: "/imports/{import_id}",
      pathParameters: { import_id: "22222222-2222-4222-8222-222222222222" },
      claims: { sub: "bob", "custom:tenant_id": "other" },
    });
    expect(res.statusCode).toBe(404);
    expect(vi.mocked(repo.getById).mock.calls[0]![0]).toMatchObject({
      tenantId: "other",
      userSub: "bob",
    });
  });

  it("rejects a non-uuid id with 400", async () => {
    const res = await invoke({
      method: "GET",
      resource: "/imports/{import_id}",
      pathParameters: { import_id: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.getById).not.toHaveBeenCalled();
  });
});
