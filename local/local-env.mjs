// Local-only defaults for the AWS-backed pieces of the API, served by moto
// (local/docker-compose.yml). Shared by local/server.ts, local/import-worker.ts,
// local/aws-local-init.mjs and the test helpers so every entry point agrees on
// the same names. Nothing here is a secret: moto accepts any credentials.
export const LOCAL_AWS = {
  endpoint: "http://localhost:5000",
  region: "eu-west-2",
  accountId: "123456789012", // moto's fixed default account
  bucket: "todo-api-local-imports",
  queue: "todo-api-local-imports",
  kmsAlias: "alias/todo-api-local-imports",
};

export const queueUrlFor = (endpoint, accountId, queue) => `${endpoint}/${accountId}/${queue}`;
export const kmsAliasArn = (region, accountId, alias) =>
  `arn:aws:kms:${region}:${accountId}:${alias}`;

// Fill in whatever the caller did not set (a test may point at a moto started
// by testcontainers instead of the compose one).
export function applyLocalAwsDefaults(env = process.env) {
  env.AWS_ENDPOINT_URL ??= LOCAL_AWS.endpoint;
  env.AWS_REGION ??= LOCAL_AWS.region;
  env.AWS_ACCESS_KEY_ID ??= "local";
  env.AWS_SECRET_ACCESS_KEY ??= "local";
  env.IMPORT_BUCKET ??= LOCAL_AWS.bucket;
  env.IMPORT_KMS_KEY_ARN ??= kmsAliasArn(env.AWS_REGION, LOCAL_AWS.accountId, LOCAL_AWS.kmsAlias);
  env.IMPORT_QUEUE_URL ??= queueUrlFor(env.AWS_ENDPOINT_URL, LOCAL_AWS.accountId, LOCAL_AWS.queue);
  return env;
}
