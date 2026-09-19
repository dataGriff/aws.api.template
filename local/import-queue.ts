import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

// Stands in for the Lambda event-source mapping when running locally or in
// tests: receives S3 notifications from the (moto) queue, hands them to the
// REAL ingest handler as an SQS event and deletes the ones it processed. A
// throwing handler leaves its messages in the queue for redelivery — the same
// semantics as the deployed mapping (which then dead-letters them).

export type IngestHandler = (event: unknown, context: unknown) => Promise<unknown>;

export function sqsClientFromEnv(): SQSClient {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  return new SQSClient({
    region: process.env.AWS_REGION ?? "eu-west-2",
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
}

const context = {
  awsRequestId: `local-${Date.now()}`,
  functionName: "import-worker",
  memoryLimitInMB: "512",
  getRemainingTimeInMillis: () => 120_000,
};

export async function processQueueOnce(
  sqs: SQSClient,
  queueUrl: string,
  handler: IngestHandler,
  waitSeconds = 0,
): Promise<unknown[]> {
  const received = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: waitSeconds,
    }),
  );
  const messages = received.Messages ?? [];
  if (messages.length === 0) return [];

  const event = {
    Records: messages.map((m) => ({
      messageId: m.MessageId,
      receiptHandle: m.ReceiptHandle,
      body: m.Body ?? "",
      attributes: {},
      messageAttributes: {},
      md5OfBody: m.MD5OfBody ?? "",
      eventSource: "aws:sqs",
      eventSourceARN: "",
      awsRegion: process.env.AWS_REGION ?? "eu-west-2",
    })),
  };
  const outcomes = (await handler(event, context)) as unknown[];
  for (const m of messages) {
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }),
    );
  }
  return outcomes;
}

// Polls until the handler reports at least one real outcome (completed or
// rejected). S3 also delivers an `s3:TestEvent` when a notification is
// configured, and deliveries are at-least-once, so "skipped" outcomes are
// expected noise, not results. Used by the tests and the contract run.
export async function processUntilOutcome(
  sqs: SQSClient,
  queueUrl: string,
  handler: IngestHandler,
  { attempts = 5, waitSeconds = 2 } = {},
): Promise<{ kind: string }[]> {
  for (let i = 0; i < attempts; i++) {
    const outcomes = (await processQueueOnce(sqs, queueUrl, handler, waitSeconds)) as {
      kind: string;
    }[];
    const real = outcomes.filter((o) => o.kind !== "skipped");
    if (real.length) return real;
  }
  return [];
}
