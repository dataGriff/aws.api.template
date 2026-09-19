import { randomBytes } from "node:crypto";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { provisionImportPipeline } from "../../../../local/aws-local-init.mjs";

process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";

// The moto image the local compose file uses; keep the two in step.
export const MOTO_IMAGE = "motoserver/moto:5.2.3";

export interface StartedAws {
  endpoint: string;
  bucket: string;
  queueUrl: string;
  kmsKeyArn: string;
  s3: S3Client;
  sqs: SQSClient;
  stop: () => Promise<void>;
}

// Starts moto (S3 + SQS + KMS) in Docker — or, when TEST_AWS_ENDPOINT_URL is
// set, reuses that moto and skips Docker, the same switch TEST_DATABASE_URL is
// for Postgres — then provisions the import pipeline exactly as `task up` does
// locally, under run-unique names so suites never share state. Points the app
// at it through the same environment variables the deployed Lambda receives.
export async function startAws(): Promise<StartedAws> {
  const preset = process.env.TEST_AWS_ENDPOINT_URL;
  let container: StartedTestContainer | undefined;
  let endpoint = preset;
  if (!endpoint) {
    container = await new GenericContainer(MOTO_IMAGE)
      .withExposedPorts(5000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    endpoint = `http://${container.getHost()}:${container.getMappedPort(5000)}`;
  }

  const suffix = randomBytes(4).toString("hex");
  const provisioned = await provisionImportPipeline({
    endpoint,
    bucket: `imports-test-${suffix}`,
    queue: `imports-test-${suffix}`,
    kmsAlias: `alias/imports-test-${suffix}`,
  });

  process.env.AWS_ENDPOINT_URL = endpoint;
  process.env.AWS_REGION = provisioned.region;
  process.env.AWS_ACCESS_KEY_ID = "local";
  process.env.AWS_SECRET_ACCESS_KEY = "local";
  process.env.IMPORT_BUCKET = provisioned.bucket;
  process.env.IMPORT_KMS_KEY_ARN = provisioned.kmsKeyArn;
  process.env.IMPORT_QUEUE_URL = provisioned.queueUrl;

  const clientOptions = {
    endpoint,
    region: provisioned.region,
    forcePathStyle: true,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  };
  const s3 = new S3Client(clientOptions);
  const sqs = new SQSClient(clientOptions);
  return {
    endpoint,
    bucket: provisioned.bucket,
    queueUrl: provisioned.queueUrl,
    kmsKeyArn: provisioned.kmsKeyArn,
    s3,
    sqs,
    stop: async () => {
      s3.destroy();
      sqs.destroy();
      await container?.stop();
    },
  };
}

// Uploads a file exactly as a client would: multipart/form-data to the
// pre-signed POST target — every signed field, then the file as the last part.
export async function uploadWithPresignedPost(
  upload: { url: string; fields: Record<string, string> },
  body: string | Uint8Array,
  contentType = "text/csv",
): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append("file", new Blob([body], { type: contentType }), "upload.csv");
  return fetch(upload.url, { method: "POST", body: form });
}
