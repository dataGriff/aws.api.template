import { randomUUID } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { todoImportLimits } from "@app/contracts";
import type { TodoImport, TodoImportCreate } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import { s3Client } from "../aws.js";
import { getConfig } from "../config.js";
import { NotFoundError } from "../errors.js";
import * as repo from "../repo/imports-repo.js";

// How long the one-time upload target stays valid.
export const UPLOAD_TTL_SECONDS = 15 * 60;
export const UPLOAD_CONTENT_TYPE = "text/csv";

// Where an upload lands: the prefix the bucket notification and the ingest
// role are scoped to, then the owner's tenant, then the import id. The key is
// chosen here and pinned in the signed policy — the client cannot pick it.
export const uploadKey = (auth: AuthContext, importId: string): string =>
  `uploads/${auth.tenantId}/${importId}.csv`;

// Registers the import and mints a pre-signed S3 POST. The POST policy is the
// security boundary of the upload: key, content type, size range and SSE-KMS
// key are conditions S3 itself enforces, so an oversized, differently typed or
// unencrypted object never enters the bucket. The bucket policy repeats the
// encryption rule for anything that did not come through here.
export async function createImport(
  auth: AuthContext,
  input: TodoImportCreate,
): Promise<TodoImport> {
  const cfg = getConfig();
  // Deployment wiring, not a client condition: surfaces as a 500 in the logs.
  if (!cfg.IMPORT_BUCKET) throw new Error("IMPORT_BUCKET is not configured");

  const importId = randomUUID();
  const key = uploadKey(auth, importId);
  // Every field becomes an exact-match condition in the signed policy.
  const fields: Record<string, string> = { "Content-Type": UPLOAD_CONTENT_TYPE };
  if (cfg.IMPORT_KMS_KEY_ARN) {
    fields["x-amz-server-side-encryption"] = "aws:kms";
    fields["x-amz-server-side-encryption-aws-kms-key-id"] = cfg.IMPORT_KMS_KEY_ARN;
  }
  const { url, fields: signedFields } = await createPresignedPost(s3Client(), {
    Bucket: cfg.IMPORT_BUCKET,
    Key: key,
    Expires: UPLOAD_TTL_SECONDS,
    Fields: fields,
    Conditions: [["content-length-range", 1, todoImportLimits.maxBytes]],
  });
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString();

  const record = await repo.create(auth, { importId, fileName: input.file_name, objectKey: key });
  return {
    ...repo.toTodoImport(record),
    upload: {
      url,
      fields: signedFields,
      expires_at: expiresAt,
      max_bytes: todoImportLimits.maxBytes,
    },
  };
}

export async function getImport(auth: AuthContext, importId: string): Promise<TodoImport> {
  const record = await repo.getById(auth, importId);
  if (!record) throw new NotFoundError(`Import ${importId} not found`);
  return repo.toTodoImport(record);
}
