import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
  CreateTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";

process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";

const stackTf = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../infra/terraform/stack/main.tf",
);

// The idempotency table's key and TTL attribute as Terraform declares them, so
// the test exercises the schema that is actually deployed (and fails if it
// drifts from what Powertools expects).
export function idempotencyTableSchemaFromTerraform(): { hashKey: string; ttlAttribute: string } {
  const tf = readFileSync(stackTf, "utf8");
  const block = /resource "aws_dynamodb_table" "idempotency" \{([\s\S]*?)\n\}/.exec(tf)?.[1];
  if (!block) throw new Error("aws_dynamodb_table.idempotency not found in stack/main.tf");
  const hashKey = /hash_key\s*=\s*"([^"]+)"/.exec(block)?.[1];
  const ttlAttribute = /ttl \{[\s\S]*?attribute_name\s*=\s*"([^"]+)"/.exec(block)?.[1];
  if (!hashKey || !ttlAttribute)
    throw new Error("could not read hash_key / ttl attribute from Terraform");
  return { hashKey, ttlAttribute };
}

export interface StartedDynamo {
  endpoint: string;
  tableName: string;
  client: DynamoDBClient;
  container: StartedTestContainer;
  stop: () => Promise<void>;
}

// Starts DynamoDB Local in Docker and creates the idempotency table exactly as
// infra does. Points the app at it via IDEMPOTENCY_TABLE / IDEMPOTENCY_ENDPOINT.
export async function startDynamo(tableName = "idempotency-test"): Promise<StartedDynamo> {
  const container = await new GenericContainer("amazon/dynamodb-local:2.5.3")
    .withCommand(["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"])
    .withExposedPorts(8000)
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8000)}`;
  const client = new DynamoDBClient({
    endpoint,
    region: "eu-west-2",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });

  const { hashKey, ttlAttribute } = idempotencyTableSchemaFromTerraform();
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: hashKey, AttributeType: "S" }],
      KeySchema: [{ AttributeName: hashKey, KeyType: "HASH" }],
    }),
  );
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: ttlAttribute, Enabled: true },
    }),
  );

  process.env.IDEMPOTENCY_TABLE = tableName;
  process.env.IDEMPOTENCY_ENDPOINT = endpoint;
  process.env.AWS_REGION ??= "eu-west-2";
  process.env.AWS_ACCESS_KEY_ID ??= "local";
  process.env.AWS_SECRET_ACCESS_KEY ??= "local";

  return {
    endpoint,
    tableName,
    client,
    container,
    stop: async () => {
      client.destroy();
      await container.stop();
    },
  };
}
