#!/usr/bin/env node
// Creates, in moto, what infra/terraform/modules/import-pipeline creates in AWS
// for the CSV import: the KMS key objects are encrypted with, the uploads
// bucket, the ingest queue and the bucket -> queue notification for
// uploads/*.csv. Idempotent; run by `task up`. Also used by the test helpers,
// which point it at a moto started with testcontainers.
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  PutBucketNotificationConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { CreateQueueCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  CreateAliasCommand,
  CreateKeyCommand,
  KMSClient,
  ListAliasesCommand,
} from "@aws-sdk/client-kms";
import { LOCAL_AWS, kmsAliasArn, queueUrlFor } from "./local-env.mjs";

const clientOptions = (endpoint, region) => ({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

export async function provisionImportPipeline({
  endpoint = LOCAL_AWS.endpoint,
  region = LOCAL_AWS.region,
  accountId = LOCAL_AWS.accountId,
  bucket = LOCAL_AWS.bucket,
  queue = LOCAL_AWS.queue,
  kmsAlias = LOCAL_AWS.kmsAlias,
} = {}) {
  const kms = new KMSClient(clientOptions(endpoint, region));
  const s3 = new S3Client(clientOptions(endpoint, region));
  const sqs = new SQSClient(clientOptions(endpoint, region));

  const aliases = await kms.send(new ListAliasesCommand({}));
  if (!aliases.Aliases?.some((a) => a.AliasName === kmsAlias)) {
    const key = await kms.send(new CreateKeyCommand({ Description: `${bucket} objects` }));
    await kms.send(
      new CreateAliasCommand({ AliasName: kmsAlias, TargetKeyId: key.KeyMetadata.KeyId }),
    );
  }

  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: queue }));
  const queueArn = `arn:aws:sqs:${region}:${accountId}:${queue}`;

  await s3
    .send(
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration: { LocationConstraint: region },
      }),
    )
    .catch((err) => {
      if (err?.name !== "BucketAlreadyOwnedByYou" && err?.name !== "BucketAlreadyExists") throw err;
    });
  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: {
        QueueConfigurations: [
          {
            QueueArn: queueArn,
            Events: ["s3:ObjectCreated:*"],
            Filter: {
              Key: {
                FilterRules: [
                  { Name: "prefix", Value: "uploads/" },
                  { Name: "suffix", Value: ".csv" },
                ],
              },
            },
          },
        ],
      },
    }),
  );
  kms.destroy();
  s3.destroy();
  sqs.destroy();
  return {
    endpoint,
    region,
    bucket,
    queueUrl: QueueUrl ?? queueUrlFor(endpoint, accountId, queue),
    queueArn,
    kmsKeyArn: kmsAliasArn(region, accountId, kmsAlias),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await provisionImportPipeline();
  console.log(
    `moto ready: bucket s3://${result.bucket}, queue ${result.queueUrl}, key ${result.kmsKeyArn}`,
  );
}
