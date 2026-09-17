import { createServer, type IncomingMessage } from "node:http";

// Local HTTP server that runs the real Lambda handler. It emulates the two
// things API Gateway does in front of Lambda: routing to a resource template,
// and turning a validated JWT into requestContext.authorizer.claims. Locally we
// decode the bearer token WITHOUT verifying its signature (a stub authorizer) —
// this is only for local dev; real auth happens at the gateway.
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgresql://app:app@localhost:5432/app";
process.env.POWERTOOLS_SERVICE_NAME ??= "todo-api-local";

const { handler } = await import("../packages/api/src/handler.ts");

const PORT = Number(process.env.PORT ?? 3000);
const STAGE = "/v1";

// Route templates mirror api/openapi.yaml (and the handler's router).
const ROUTES: { re: RegExp; resource: string; params: string[] }[] = [
  { re: /^\/health$/, resource: "/health", params: [] },
  { re: /^\/todos$/, resource: "/todos", params: [] },
  { re: /^\/todos\/([^/]+)$/, resource: "/todos/{todo_id}", params: ["todo_id"] },
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
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname.startsWith(STAGE)
      ? url.pathname.slice(STAGE.length) || "/"
      : url.pathname;
    const route = matchRoute(path);

    if (!route) {
      res.writeHead(404, { "content-type": "application/problem+json" });
      res.end(JSON.stringify({ title: "Not Found", status: 404 }));
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
      requestContext: { requestId: `local-${Date.now()}`, authorizer: claims ? { claims } : null },
    };

    const result = (await handler(event as never, { awsRequestId: "local" } as never)) as {
      statusCode: number;
      headers?: Record<string, string>;
      body?: string;
    };
    res.writeHead(result.statusCode, result.headers ?? {});
    res.end(result.body ?? "");
  })();
});

server.listen(PORT, () => {
  console.log(`Local API on http://localhost:${PORT}${STAGE}  (Prism mock on :4010)`);
});
