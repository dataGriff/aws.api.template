import { setWorldConstructor, World } from "@cucumber/cucumber";
import type { APIGatewayProxyResult } from "aws-lambda";

export interface Claims {
  sub: string;
  "custom:tenant_id": string;
  [key: string]: string;
}

// Shared per-scenario state: current identity, last response, the id of the
// most recently created todo / import and the CSV file being imported.
export class TodoWorld extends World {
  claims: Claims | null = { sub: "alice", "custom:tenant_id": "acme" };
  response?: APIGatewayProxyResult;
  lastTodoId?: string;
  lastImportId?: string;
  csv?: { fileName: string; content: string };

  body(): unknown {
    return this.response?.body ? JSON.parse(this.response.body) : undefined;
  }
}

setWorldConstructor(TodoWorld);
