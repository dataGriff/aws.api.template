import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "./config.js";
import { tracer } from "./observability.js";

// One S3 client per execution environment. With AWS_ENDPOINT_URL set (moto
// locally / in tests) it talks path-style to that endpoint with dummy
// credentials — the same switch DATABASE_URL / IDEMPOTENCY_ENDPOINT provide
// for the other stores. Deployed, the SDK's default chain applies.
let s3: S3Client | undefined;

export function s3Client(): S3Client {
  if (s3) return s3;
  const cfg = getConfig();
  s3 = new S3Client({
    region: cfg.AWS_REGION,
    ...(cfg.AWS_ENDPOINT_URL
      ? {
          endpoint: cfg.AWS_ENDPOINT_URL,
          forcePathStyle: true,
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {}),
  });
  return tracer.captureAWSv3Client(s3);
}

// Tests only.
export function resetAwsClients(): void {
  s3?.destroy();
  s3 = undefined;
}
