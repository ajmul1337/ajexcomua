import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import type { AdminRequestContext, WorkerBindings } from "./lib/admin-auth";

declare module "@tanstack/react-router" {
  interface Register {
    server: { requestContext: AdminRequestContext };
  }
}

type ServerEntry = {
  fetch: (
    request: Request,
    options?: { context: AdminRequestContext },
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function isCloudflareExecutionContext(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const context = value as { waitUntil?: unknown; passThroughOnException?: unknown };
  return (
    typeof context.waitUntil === "function" && typeof context.passThroughOnException === "function"
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      // Vercel also supplies platform arguments to its fetch adapter; their mere
      // presence does not make this a Cloudflare Worker runtime.
      const cloudflare = isCloudflareExecutionContext(ctx);
      const bindings =
        cloudflare && env && typeof env === "object" ? (env as WorkerBindings) : undefined;
      const response = await handler.fetch(request, {
        context: { adminRuntime: bindings ? { cloudflare, bindings } : { cloudflare } },
      });
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
