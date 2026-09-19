// Public surface of the generated consumer SDK.
// Everything under ./generated is produced by `pnpm gen` — do not edit by hand.
export * from "./generated/client/index.js";
export * from "./generated/types/index.js";

// ---------------------------------------------------------------------------
// Hand-written convenience layer (kept here so it survives regeneration).
//
// The generated functions accept `{ client }` and return the response body
// only. The default fetch client resolves on ANY status, so without a wrapper
// a consumer calling getTodo() on a missing id would receive the RFC 7807
// problem document typed as a Todo. createClient() supplies auth headers and
// turns every non-2xx into a typed ApiError carrying the problem body.
// ---------------------------------------------------------------------------
import baseClient, {
  type RequestConfig,
  type ResponseConfig,
} from "@kubb/plugin-client/clients/fetch";
import type { Problem } from "./generated/types/index.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | undefined,
    readonly requestId: string | undefined,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  /** e.g. https://api.example.com/v1 — the server URL including the base path */
  baseURL: string;
  /** Cognito access token, or a function returning one (refreshed per call) */
  token?: string | (() => string | Promise<string>);
  /** API key for usage plans (x-api-key) */
  apiKey?: string;
}

export type Client = typeof baseClient;

const isProblem = (value: unknown): value is Problem =>
  typeof value === "object" && value !== null && "status" in value && "title" in value;

/**
 * Build a client to pass to any generated function as `{ client }`:
 *
 *   const { client } = createClient({ baseURL, token, apiKey });
 *   const todo = await createTodo({ title: "x" }, { "idempotency-key": key }, { client });
 *   try { await getTodo(id, { client }); } catch (e) { if (e instanceof ApiError && e.status === 404) ... }
 */
export function createClient(options: ClientOptions): { client: Client } {
  const request = async <TData, TError = unknown, TVariables = unknown>(
    config: RequestConfig<TVariables>,
  ): Promise<ResponseConfig<TData>> => {
    const token = typeof options.token === "function" ? await options.token() : options.token;
    const response = await baseClient<TData, TError, TVariables>({
      ...config,
      baseURL: options.baseURL,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
        ...(config.data !== undefined ? { "content-type": "application/json" } : {}),
        ...(config.headers ?? {}),
      },
    });
    if (response.status >= 400) {
      const body: unknown = response.data;
      throw new ApiError(
        response.status,
        isProblem(body) ? body : undefined,
        response.headers.get("x-request-id") ?? undefined,
      );
    }
    return response;
  };
  const client: Client = Object.assign(request, {
    getConfig: baseClient.getConfig,
    setConfig: baseClient.setConfig,
  });
  return { client };
}
