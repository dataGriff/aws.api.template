import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, SQSEvent } from "aws-lambda";
import * as importsRepo from "../../src/repo/imports-repo.js";
import * as todosRepo from "../../src/repo/todos-repo.js";
import * as storage from "../../src/import/storage.js";
import * as pool from "../../src/db/pool.js";
import { handler, processObject } from "../../src/import/handler.js";

// The ingest with its two I/O edges mocked (S3 via storage.ts, Postgres via the
// repositories + withTransaction). What is under test is the decision logic:
// trust model, atomicity, idempotency and which outcome each input produces.
vi.mock("../../src/repo/imports-repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/repo/imports-repo.js")>();
  return { ...actual, findByObjectKey: vi.fn(), markProcessing: vi.fn(), finish: vi.fn() };
});
vi.mock("../../src/repo/todos-repo.js");
vi.mock("../../src/import/storage.js");
vi.mock("../../src/db/pool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/pool.js")>();
  return { ...actual, withTransaction: vi.fn() };
});

const KEY = "uploads/acme/33333333-3333-4333-8333-333333333333.csv";
const record = (over: Partial<importsRepo.ImportRecord> = {}): importsRepo.ImportRecord => ({
  import_id: "33333333-3333-4333-8333-333333333333",
  tenant_id: "acme",
  user_sub: "alice",
  object_key: KEY,
  file_name: "todos.csv",
  status: "awaiting_upload",
  row_count: null,
  created_count: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  completed_at: null,
  ...over,
});
const encode = (s: string) => new TextEncoder().encode(s);
const VALID = "title,description,status,due_date\nA,,open,\nB,desc,done,2030-01-01\n";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.head).mockResolvedValue({ size: 100, contentType: "text/csv" });
  vi.mocked(storage.quarantine).mockResolvedValue("quarantine/x");
  vi.mocked(importsRepo.finish).mockImplementation(async (id, outcome) =>
    record({
      status: outcome.status,
      row_count: outcome.rowCount,
      created_count: outcome.createdCount,
    }),
  );
  // A transparent transaction: run the callback with a stand-in connection.
  vi.mocked(pool.withTransaction).mockImplementation(async (fn) => fn({ query: vi.fn() }));
  vi.mocked(todosRepo.create).mockImplementation(async (_auth, input) => ({
    todo_id: "t",
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "open",
    due_date: input.due_date ?? null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
});

describe("processObject — a valid file", () => {
  it("creates every row as the import owner inside the transaction that completes the import", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record());
    vi.mocked(storage.read).mockResolvedValue(encode(VALID));

    const outcome = await processObject(KEY);
    expect(outcome).toEqual({ kind: "completed", importId: record().import_id, rowCount: 2 });

    expect(importsRepo.markProcessing).toHaveBeenCalledWith(record().import_id);
    expect(pool.withTransaction).toHaveBeenCalledTimes(1);
    const tx = vi.mocked(importsRepo.finish).mock.calls[0]![2];
    expect(tx).toBeDefined();
    expect(importsRepo.finish).toHaveBeenCalledWith(
      record().import_id,
      { status: "completed", rowCount: 2, createdCount: 2 },
      tx,
    );
    // Identity comes from the import row, never from the file; same connection.
    expect(todosRepo.create).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(todosRepo.create).mock.calls) {
      expect(call[0]).toEqual({ tenantId: "acme", userSub: "alice", groups: [] });
      expect(call[2]).toBe(tx);
    }
    expect(vi.mocked(todosRepo.create).mock.calls[1]![1]).toEqual({
      title: "B",
      description: "desc",
      status: "done",
      due_date: "2030-01-01",
    });
    expect(storage.remove).toHaveBeenCalledWith(KEY);
    expect(storage.quarantine).not.toHaveBeenCalled();
  });

  it("writes nothing on a duplicate delivery: the guarded transition finds no row", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record({ status: "processing" }));
    vi.mocked(storage.read).mockResolvedValue(encode(VALID));
    vi.mocked(importsRepo.finish).mockResolvedValue(null);

    const outcome = await processObject(KEY);
    expect(outcome.kind).toBe("skipped");
    expect(todosRepo.create).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("skips an import that already finished without touching S3 or the database", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record({ status: "completed" }));
    expect((await processObject(KEY)).kind).toBe("skipped");
    expect(storage.head).not.toHaveBeenCalled();
    expect(importsRepo.finish).not.toHaveBeenCalled();
  });
});

describe("processObject — rejection = quarantine + record + alert metric, nothing created", () => {
  it("rejects a file that violates the contract and stores the full report next to it", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record());
    vi.mocked(storage.read).mockResolvedValue(
      encode("title,description,status,due_date\nok,,open,\n,,archived,\n"),
    );

    const outcome = await processObject(KEY);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.errors.map((e) => [e.row, e.field])).toEqual([
      [2, "title"],
      [2, "status"],
    ]);

    expect(todosRepo.create).not.toHaveBeenCalled();
    expect(pool.withTransaction).not.toHaveBeenCalled();
    const [qKey, report] = vi.mocked(storage.quarantine).mock.calls[0]!;
    expect(qKey).toBe(KEY);
    expect(report).toMatchObject({
      import_id: record().import_id,
      object_key: KEY,
      row_count: 2,
      error_count: 2,
      contract: { id: "todo-import", apiVersion: "v3.2.0" },
    });
    expect(importsRepo.finish).toHaveBeenCalledWith(record().import_id, {
      status: "rejected",
      rowCount: 2,
      createdCount: 0,
      errors: outcome.errors,
    });
  });

  it("rejects an oversized object from its metadata alone, without downloading it", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record());
    vi.mocked(storage.head).mockResolvedValue({ size: 10 * 1024 * 1024, contentType: "text/csv" });
    const outcome = await processObject(KEY);
    expect(outcome).toMatchObject({ kind: "rejected", errors: [{ row: 0, field: "size" }] });
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.quarantine).toHaveBeenCalled();
  });

  it("rejects an object with another content type", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(record());
    vi.mocked(storage.head).mockResolvedValue({
      size: 10,
      contentType: "application/octet-stream",
    });
    expect(await processObject(KEY)).toMatchObject({
      kind: "rejected",
      errors: [{ row: 0, field: "content_type" }],
    });
  });

  it("quarantines an object nobody registered (not created through the API) and records no import", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(null);
    const outcome = await processObject("uploads/intruder/whatever.csv");
    expect(outcome).toMatchObject({ kind: "rejected", importId: undefined });
    expect(storage.quarantine).toHaveBeenCalledWith(
      "uploads/intruder/whatever.csv",
      expect.objectContaining({ import_id: null }),
    );
    expect(importsRepo.finish).not.toHaveBeenCalled();
    expect(storage.head).not.toHaveBeenCalled();
  });

  it("ignores keys outside uploads/ (quarantine writes must never re-trigger the ingest)", async () => {
    expect(await processObject("quarantine/acme/x.csv")).toMatchObject({ kind: "skipped" });
    expect(importsRepo.findByObjectKey).not.toHaveBeenCalled();
  });
});

describe("SQS/S3 event plumbing", () => {
  const context = {
    awsRequestId: "r",
    getRemainingTimeInMillis: () => 60_000,
  } as unknown as Context;
  const sqsEvent = (bodies: unknown[]): SQSEvent =>
    ({
      Records: bodies.map((b, i) => ({
        messageId: String(i),
        receiptHandle: "h",
        body: JSON.stringify(b),
        attributes: {},
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "eu-west-2",
      })),
    }) as unknown as SQSEvent;

  it("decodes URL-encoded keys, ignores the S3 test event and non-create events", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockResolvedValue(
      record({ object_key: "uploads/acme/my file.csv" }),
    );
    vi.mocked(storage.read).mockResolvedValue(encode(VALID));
    const outcomes = await handler(
      sqsEvent([
        { Event: "s3:TestEvent" },
        {
          Records: [
            {
              eventName: "ObjectCreated:Post",
              s3: { object: { key: "uploads/acme/my+file.csv" } },
            },
            { eventName: "ObjectRemoved:Delete", s3: { object: { key: "uploads/acme/gone.csv" } } },
          ],
        },
      ]),
      context,
    );
    expect(outcomes.map((o) => o.kind)).toEqual(["skipped", "completed", "skipped"]);
    expect(importsRepo.findByObjectKey).toHaveBeenCalledWith("uploads/acme/my file.csv");
  });

  it("lets unexpected failures propagate so SQS retries and eventually dead-letters the message", async () => {
    vi.mocked(importsRepo.findByObjectKey).mockRejectedValue(new Error("database unavailable"));
    await expect(
      handler(
        sqsEvent([{ Records: [{ eventName: "ObjectCreated:Put", s3: { object: { key: KEY } } }] }]),
        context,
      ),
    ).rejects.toThrow(/database unavailable/);
  });
});
