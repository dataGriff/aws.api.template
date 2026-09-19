import { createServer, type IncomingMessage } from "node:http";
import { applyLocalAwsDefaults } from "./local-env.mjs";

// Local HTTP server that runs the real Lambda handler. It emulates the two
// things API Gateway does in front of Lambda: routing to a resource template,
// and turning a validated JWT into requestContext.authorizer.claims. Locally we
// decode the bearer token WITHOUT verifying its signature (a stub authorizer) —
// this is only for local dev; real auth happens at the gateway.
process.env.APP_ENV ??= "local";
if (process.env.APP_ENV !== "local") {
  throw new Error(
    `local/server.ts uses an unverified stub authorizer and only runs with APP_ENV=local (got "${process.env.APP_ENV}")`,
  );
}
process.env.DATABASE_URL ??= "postgresql://app:app@localhost:5432/app";
process.env.POWERTOOLS_SERVICE_NAME ??= "todo-api-local";
// S3/KMS for POST /imports come from moto (local/docker-compose.yml).
applyLocalAwsDefaults();

const { handler } = await import("../packages/api/src/handler.ts");

const PORT = Number(process.env.PORT ?? 3000);
// Loopback only: the stub authorizer must never be reachable from the LAN.
const HOST = process.env.HOST ?? "127.0.0.1";
const STAGE = "/v1";

// Route templates mirror api/openapi.yaml (and the handler's router).
const ROUTES: { re: RegExp; resource: string; params: string[] }[] = [
  { re: /^\/health$/, resource: "/health", params: [] },
  { re: /^\/todos$/, resource: "/todos", params: [] },
  { re: /^\/todos\/([^/]+)$/, resource: "/todos/{todo_id}", params: ["todo_id"] },
  { re: /^\/imports$/, resource: "/imports", params: [] },
  { re: /^\/imports\/([^/]+)$/, resource: "/imports/{import_id}", params: ["import_id"] },
];

function matchRoute(path: string) {
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) {
      const pathParameters: Record<string, string> = {};
      r.params.forEach((p, i) => (pathParameters[p] = decodeURIComponent(m[i + 1]!)));
      return { resource: r.resource, pathParameters };
    }
  }
  return null;
}

function decodeClaims(auth?: string): Record<string, string> | undefined {
  if (!auth?.startsWith("Bearer ")) return undefined;
  try {
    const payload = auth.slice(7).split(".")[1];
    if (!payload) return undefined;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, string>;
  } catch {
    return undefined;
  }
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const problem = (status: number, title: string) =>
  JSON.stringify({ type: "about:blank", title, status });

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const path = url.pathname.startsWith(STAGE)
      ? url.pathname.slice(STAGE.length) || "/"
      : url.pathname;
    const route = matchRoute(path);

    if (!route) {
      res.writeHead(404, { "content-type": "application/problem+json" });
      res.end(problem(404, "Not Found"));
      return;
    }

    const body = await readBody(req);
    const claims = decodeClaims(req.headers.authorization);
    const query = Object.fromEntries(url.searchParams.entries());

    const event = {
      httpMethod: req.method,
      resource: route.resource,
      path,
      pathParameters: Object.keys(route.pathParameters).length ? route.pathParameters : null,
      queryStringParameters: Object.keys(query).length ? query : null,
      headers: req.headers as Record<string, string>,
      multiValueHeaders: {},
      body: body || null,
      isBase64Encoded: false,
      stageVariables: null,
      requestContext: {
        requestId: `local-${Date.now()}`,
        // As at API Gateway, requestContext.path includes the stage prefix.
        path: url.pathname,
        authorizer: claims ? { claims } : null,
      },
    };

    const result = (await handler(event as never, { awsRequestId: "local" } as never)) as {
      statusCode: number;
      headers?: Record<string, string>;
      body?: string;
    };
    res.writeHead(result.statusCode, result.headers ?? {});
    res.end(result.body ?? "");
  })().catch((err: unknown) => {
    // The handler's error mapper normally produces a 500 itself; this catches
    // failures outside it (bad request stream, malformed result) so a single
    // request can never take the dev server down.
    console.error("local server error:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/problem+json" });
    res.end(problem(500, "Internal Server Error"));
  });
});

// Requests Node's HTTP parser rejects (malformed header values, oversized
// headers) never reach the handler. API Gateway renders those as problem+json
// through its gateway responses; mirror that instead of Node's bare 400.
server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
  if (err.code === "ECONNRESET" || !socket.writable) {
    socket.destroy();
    return;
  }
  const body = problem(400, "Bad Request");
  socket.end(
    `HTTP/1.1 400 Bad Request\r\ncontent-type: application/problem+json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
  );
});

server.listen(PORT, HOST, () => {
  console.log(`Local API on http://${HOST}:${PORT}${STAGE}  (Prism mock on :4010)`);
});
