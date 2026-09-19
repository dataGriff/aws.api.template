import { Given, Then, When, type DataTable } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { invoke } from "../../helpers/invoke.js";
import { uploadWithPresignedPost } from "../../helpers/aws.js";
import { aws } from "./hooks.js";
import type { TodoWorld } from "./world.js";

// Cells are written as-is (quoted when needed) so the file is a real CSV, not
// a pre-parsed structure — the scenario exercises the parser too.
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

Given(
  "a CSV file {string} with the rows:",
  function (this: TodoWorld, fileName: string, table: DataTable) {
    const rows = table.raw();
    this.csv = { fileName, content: rows.map((r) => r.map(cell).join(",")).join("\n") + "\n" };
  },
);

When("I upload it through an import", async function (this: TodoWorld) {
  assert.ok(this.csv, "no CSV file prepared");
  this.response = await invoke({
    method: "POST",
    resource: "/imports",
    body: { file_name: this.csv.fileName },
    claims: this.claims,
  });
  assert.equal(this.response.statusCode, 201, this.response.body);
  const created = this.body() as {
    import_id: string;
    upload: { url: string; fields: Record<string, string> };
  };
  this.lastImportId = created.import_id;

  const uploaded = await uploadWithPresignedPost(created.upload, this.csv.content);
  assert.ok(uploaded.status < 300, `upload failed: ${uploaded.status} ${await uploaded.text()}`);

  // Stand in for the SQS -> Lambda mapping: run the real ingest on the
  // notification S3 just queued.
  const { processUntilOutcome } = await import("../../../../../local/import-queue.js");
  const { handler } = await import("../../../src/import/handler.js");
  const outcomes = await processUntilOutcome(aws.sqs, aws.queueUrl, handler as never);
  assert.ok(outcomes.length, "the ingest never received the S3 notification");
  this.response = await invoke({
    method: "GET",
    resource: "/imports/{import_id}",
    pathParameters: { import_id: created.import_id },
    claims: this.claims,
  });
});

When(
  "user {string} in tenant {string} fetches that import",
  async function (this: TodoWorld, user: string, tenant: string) {
    this.response = await invoke({
      method: "GET",
      resource: "/imports/{import_id}",
      pathParameters: { import_id: this.lastImportId! },
      claims: { sub: user, "custom:tenant_id": tenant },
    });
  },
);

Then("the import status is {string}", function (this: TodoWorld, status: string) {
  assert.equal(this.response?.statusCode, 200, this.response?.body);
  assert.equal((this.body() as { status: string }).status, status, this.response?.body);
});

Then(
  "the import reports {int} rows and {int} created",
  function (this: TodoWorld, rows: number, created: number) {
    const body = this.body() as { row_count: number; created_count: number };
    assert.equal(body.row_count, rows);
    assert.equal(body.created_count, created);
  },
);

Then(
  "the import reports an error on row {int} for {string}",
  function (this: TodoWorld, row: number, field: string) {
    const body = this.body() as { errors?: { row: number; field: string }[] };
    assert.ok(
      body.errors?.some((e) => e.row === row && e.field === field),
      `no error for row ${row} field ${field} in ${JSON.stringify(body.errors)}`,
    );
  },
);

Then("the file is quarantined with a report", async function (this: TodoWorld) {
  const prefix = `quarantine/${this.claims!["custom:tenant_id"]}/${this.lastImportId}`;
  const listed = await aws.s3.send(
    new ListObjectsV2Command({ Bucket: aws.bucket, Prefix: prefix }),
  );
  const keys = (listed.Contents ?? []).map((o) => o.Key).sort();
  assert.deepEqual(keys, [`${prefix}.csv`, `${prefix}.csv.report.json`]);
});
