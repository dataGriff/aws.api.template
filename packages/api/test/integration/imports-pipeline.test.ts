import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { startDb, type TestDatabase } from "../helpers/db.js";
import { startAws, uploadWithPresignedPost, type StartedAws } from "../helpers/aws.js";
import type { AuthContext } from "../../src/auth/claims.js";

// The import pipeline end to end against real stores: a pre-signed POST into
// S3 (moto), S3's own bucket notification into SQS, the ingest handler fed
// from that queue exactly as the Lambda mapping feeds it, and Postgres with
// every migration applied. Only the Lambda runtime itself is absent.
let db: TestDatabase;
let aws: StartedAws;
let imports: typeof import("../../src/domain/imports.js");
let todos: typeof import("../../src/repo/todos-repo.js");
let ingest: typeof import("../../src/import/handler.js");
let queue: typeof import("../../../../local/import-queue.js");
let closePool: () => Promise<void>;

const alice: AuthContext = { userSub: "alice", tenantId: "acme", groups: [] };
const bob: AuthContext = { userSub: "bob", tenantId: "acme", groups: [] };
const VALID = "title,description,status,due_date\nA,,open,\nB,desc,done,2030-01-01\nC,,,\n";
const INVALID = "title,description,status,due_date\nok,,open,\n,,archived,\n";

// Feeds the ingest from the queue like the Lambda mapping does; S3's test
// event and duplicate deliveries come back as "skipped" and are filtered.
const drain = () => queue.processUntilOutcome(aws.sqs, aws.queueUrl, ingest.handler as never);

const listKeys = async (prefix: string) =>
  (
    (await aws.s3.send(new ListObjectsV2Command({ Bucket: aws.bucket, Prefix: prefix })))
      .Contents ?? []
  )
    .map((o) => o.Key!)
    .sort();

beforeAll(async () => {
  db = await startDb();
  aws = await startAws();
  const { resetConfig } = await import("../../src/config.js");
  const { resetAwsClients } = await import("../../src/aws.js");
  resetConfig();
  resetAwsClients();
  imports = await import("../../src/domain/imports.js");
  todos = await import("../../src/repo/todos-repo.js");
  ingest = await import("../../src/import/handler.js");
  queue = await import("../../../../local/import-queue.js");
  ({ closePool } = await import("../../src/db/pool.js"));
}, 240_000);

afterAll(async () => {
  await closePool?.();
  await aws?.stop();
  await db?.stop();
});

describe("CSV import pipeline (S3 -> SQS -> ingest -> Postgres)", () => {
  it("a file that meets the contract is uploaded, picked up from the queue and becomes todos atomically", async () => {
    const created = await imports.createImport(alice, { file_name: "todos.csv" });
    expect(created.status).toBe("awaiting_upload");
    const key = created.upload!.fields.key!;
    expect(key).toBe(`uploads/acme/${created.import_id}.csv`);

    const res = await uploadWithPresignedPost(created.upload!, VALID);
    expect(res.status, await res.text()).toBeLessThan(300);
    // (moto stores the object but ignores the SSE form fields; the handler test
    // asserts the signed policy and terraform test the bucket encryption.)
    const head = await aws.s3.send(new HeadObjectCommand({ Bucket: aws.bucket, Key: key }));
    expect(head.ContentType).toBe("text/csv");

    const outcomes = await drain();
    expect(outcomes).toEqual([{ kind: "completed", importId: created.import_id, rowCount: 3 }]);

    const status = await imports.getImport(alice, created.import_id);
    expect(status).toMatchObject({ status: "completed", row_count: 3, created_count: 3 });
    expect(status.completed_at).toBeTruthy();
    expect(status).not.toHaveProperty("upload");

    const page = await todos.list(alice, { limit: 10 });
    expect(page.items.map((t) => [t.title, t.status, t.due_date]).sort()).toEqual([
      ["A", "open", null],
      ["B", "done", "2030-01-01"],
      ["C", "open", null],
    ]);
    // Processed uploads do not linger; nothing was quarantined.
    await expect(
      aws.s3.send(new HeadObjectCommand({ Bucket: aws.bucket, Key: key })),
    ).rejects.toMatchObject({
      name: "NotFound",
    });
    expect(await listKeys("quarantine/")).toEqual([]);

    // Replaying the notification is harmless: the import is already finished.
    expect(await ingest.processObject(key)).toMatchObject({ kind: "skipped" });
    expect((await todos.list(alice, { limit: 10 })).items).toHaveLength(3);
  });

  it("a file that violates the contract creates nothing, is quarantined with its report and reported as rejected", async () => {
    const before = (await todos.list(bob, { limit: 100 })).items.length;
    const created = await imports.createImport(bob, { file_name: "bad.csv" });
    const key = created.upload!.fields.key!;
    expect((await uploadWithPresignedPost(created.upload!, INVALID)).status).toBeLessThan(300);

    const outcomes = await drain();
    expect(outcomes[0]).toMatchObject({ kind: "rejected", importId: created.import_id });

    const status = await imports.getImport(bob, created.import_id);
    expect(status).toMatchObject({ status: "rejected", row_count: 2, created_count: 0 });
    expect(status.errors).toEqual([
      { row: 2, field: "title", message: expect.any(String) },
      { row: 2, field: "status", message: expect.any(String) },
    ]);
    expect((await todos.list(bob, { limit: 100 })).items).toHaveLength(before);

    const quarantined = `quarantine/acme/${created.import_id}.csv`;
    expect(await listKeys(`quarantine/acme/${created.import_id}`)).toEqual([
      quarantined,
      `${quarantined}.report.json`,
    ]);
    await expect(
      aws.s3.send(new HeadObjectCommand({ Bucket: aws.bucket, Key: key })),
    ).rejects.toMatchObject({
      name: "NotFound",
    });
    const copy = await aws.s3.send(new GetObjectCommand({ Bucket: aws.bucket, Key: quarantined }));
    expect(await copy.Body!.transformToString()).toBe(INVALID);
    expect(copy.ServerSideEncryption).toBe("aws:kms");
    const report = JSON.parse(
      await (
        await aws.s3.send(
          new GetObjectCommand({ Bucket: aws.bucket, Key: `${quarantined}.report.json` }),
        )
      ).Body!.transformToString(),
    ) as { import_id: string; error_count: number; errors: unknown[]; contract: { id: string } };
    expect(report).toMatchObject({
      import_id: created.import_id,
      error_count: 2,
      contract: { id: "todo-import" },
    });
    expect(report.errors).toHaveLength(2);
  });

  it("an object that did not come through create_import is quarantined and owns no rows", async () => {
    await aws.s3.send(
      new PutObjectCommand({
        Bucket: aws.bucket,
        Key: "uploads/acme/not-registered.csv",
        Body: VALID,
        ContentType: "text/csv",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: aws.kmsKeyArn,
      }),
    );
    const outcomes = await drain();
    expect(outcomes[0]).toMatchObject({ kind: "rejected", importId: undefined });
    expect(await listKeys("quarantine/acme/not-registered")).toEqual([
      "quarantine/acme/not-registered.csv",
      "quarantine/acme/not-registered.csv.report.json",
    ]);
  });

  it("imports are scoped to their owner", async () => {
    const created = await imports.createImport(alice, { file_name: "mine.csv" });
    await expect(imports.getImport(bob, created.import_id)).rejects.toMatchObject({ status: 404 });
  });
});
