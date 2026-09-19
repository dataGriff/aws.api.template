import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { todoImportLimits } from "@app/contracts";
import { s3Client } from "../aws.js";
import { getConfig } from "../config.js";

// The ingest's view of the bucket. Everything it does is confined to the
// `uploads/` prefix (read + delete) and the quarantine prefix (write) — the
// IAM policy of the ingest role is scoped the same way.

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

const bucket = (): string => {
  const name = getConfig().IMPORT_BUCKET;
  if (!name) throw new Error("IMPORT_BUCKET is not configured");
  return name;
};

// Objects written by us must carry the same encryption the bucket policy
// demands of uploads (a CopyObject is a PutObject).
const sse = () => {
  const key = getConfig().IMPORT_KMS_KEY_ARN;
  return key ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: key } : {};
};

export async function head(key: string): Promise<ObjectInfo> {
  const res = await s3Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  return { size: res.ContentLength ?? 0, contentType: res.ContentType };
}

// Reads at most `limit` bytes (+1 so an oversized object is detected without
// buffering all of it). Callers check the size from head() first; this is the
// belt to that brace.
export async function read(key: string, limit = todoImportLimits.maxBytes): Promise<Uint8Array> {
  const res = await s3Client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${limit}` }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return bytes;
}

export const quarantineKey = (key: string): string =>
  `${todoImportLimits.quarantinePrefix}${key.replace(/^uploads\//, "")}`;

// Moves the offending object under the quarantine prefix and writes the full
// violation report next to it, then removes the original so nothing under
// `uploads/` is ever half-processed. Quarantined objects are retained by the
// bucket lifecycle for review (see infra/terraform/modules/import-pipeline).
export async function quarantine(key: string, report: unknown): Promise<string> {
  const target = quarantineKey(key);
  const client = s3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket(),
      CopySource: `/${bucket()}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
      Key: target,
      MetadataDirective: "REPLACE",
      ContentType: "text/csv",
      Tagging: "quarantined=true",
      TaggingDirective: "REPLACE",
      ...sse(),
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: `${target}.report.json`,
      Body: JSON.stringify(report, null, 2),
      ContentType: "application/json",
      ...sse(),
    }),
  );
  await remove(key);
  return target;
}

export async function remove(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
