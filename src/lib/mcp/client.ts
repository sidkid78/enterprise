import "server-only";

/**
 * Minimal MCP client over the Streamable HTTP transport.
 *
 * Only the two methods the runtime needs — `tools/list` and `tools/call` —
 * rather than a general MCP implementation. A dependency would bring a session
 * lifecycle, notification handling and stdio support that this never uses.
 *
 * Streamable HTTP is the only transport supported. `sse` is the deprecated
 * predecessor and `stdio` means a local subprocess, which a serverless request
 * has nowhere to run; the registry can hold either, and callers refuse them.
 */

/** JSON-RPC id counter. Per-process is sufficient: ids need only be unique per connection. */
let nextId = 1;

export type McpToolDefinition = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  /** Flattened text of the result content blocks. */
  text: string;
  /** The raw structured result, when the server returned one. */
  structured: unknown;
  /** True when the server reported the tool itself failed. */
  isError: boolean;
};

export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** Wall-clock ceiling for one MCP request. A hung server must not hold a run open. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The MCP protocol revision this client implements.
 *
 * Sent on initialize; a server that speaks a different revision answers with
 * its own and the two are expected to be compatible within a major line.
 */
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/**
 * Parses a Streamable HTTP response body.
 *
 * A server may answer a POST with either a single JSON object or an SSE stream
 * of `data:` frames — both are legal on this transport, and which one arrives
 * is the server's choice, not the client's. Handling only JSON works until the
 * first server that streams.
 */
function parseBody(contentType: string, body: string): JsonRpcResponse {
  if (contentType.includes("text/event-stream")) {
    const frames = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    if (frames.length === 0) {
      throw new McpError("Server sent an event stream with no data frames.");
    }
    // The response to a request is the last data frame; earlier frames are
    // progress notifications, which this client does not surface.
    return JSON.parse(frames[frames.length - 1]) as JsonRpcResponse;
  }

  return JSON.parse(body) as JsonRpcResponse;
}

export type McpConnection = {
  endpointUrl: string;
  headers: Record<string, string>;
  /** Assigned by the server on initialize; echoed on every later request. */
  sessionId?: string;
};

async function rpc(
  connection: McpConnection,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(connection.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Both are advertised because the server picks which to send back.
        accept: "application/json, text/event-stream",
        ...(connection.sessionId
          ? { "mcp-session-id": connection.sessionId }
          : {}),
        ...connection.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method,
        params,
      }),
      signal: controller.signal,
      // No redirect following: an MCP endpoint that redirects is either
      // misconfigured or being repointed at a host we did not authorize, and
      // the auth header would follow it.
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new McpError(`Timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw new McpError(
      `Could not reach server: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) connection.sessionId = sessionId;

  const body = await response.text();

  if (!response.ok) {
    throw new McpError(
      `Server returned ${response.status}: ${body.slice(0, 200)}`,
      response.status,
    );
  }

  // A notification gets an empty 202; nothing to parse.
  if (!body.trim()) return null;

  let parsed: JsonRpcResponse;
  try {
    parsed = parseBody(response.headers.get("content-type") ?? "", body);
  } catch {
    throw new McpError(`Unparseable response: ${body.slice(0, 200)}`);
  }

  if (parsed.error) {
    throw new McpError(parsed.error.message, parsed.error.code);
  }

  return parsed.result;
}

/**
 * Opens a session: `initialize`, then the `notifications/initialized` the spec
 * requires before any other request.
 */
export async function connect(params: {
  endpointUrl: string;
  headers?: Record<string, string>;
}): Promise<McpConnection> {
  const url = new URL(params.endpointUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    // Credentials travel in a header on every call.
    throw new McpError("MCP endpoints must use https (localhost excepted).");
  }

  const connection: McpConnection = {
    endpointUrl: params.endpointUrl,
    headers: params.headers ?? {},
  };

  await rpc(connection, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "enterprise-agentops", version: "1.0.0" },
  });

  // Fire-and-forget per the spec; a server that rejects it still works for
  // tools/list, so a failure here must not abort discovery.
  try {
    await fetch(connection.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(connection.sessionId
          ? { "mcp-session-id": connection.sessionId }
          : {}),
        ...connection.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  } catch {
    // Ignored deliberately — see above.
  }

  return connection;
}

/** Lists the tools a server exposes, following pagination to the end. */
export async function listTools(
  connection: McpConnection,
): Promise<McpToolDefinition[]> {
  const tools: McpToolDefinition[] = [];
  let cursor: string | undefined;

  // Bounded: a server that returns a cursor forever would otherwise spin.
  for (let page = 0; page < 20; page += 1) {
    const result = (await rpc(
      connection,
      "tools/list",
      cursor ? { cursor } : {},
    )) as {
      tools?: {
        name?: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }[];
      nextCursor?: string;
    } | null;

    for (const tool of result?.tools ?? []) {
      if (!tool.name) continue;
      tools.push({
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      });
    }

    cursor = result?.nextCursor;
    if (!cursor) break;
  }

  return tools;
}

/** Invokes one tool. */
export async function callTool(
  connection: McpConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const result = (await rpc(connection, "tools/call", {
    name,
    arguments: args,
  })) as {
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  } | null;

  const text = (result?.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    text,
    structured: result?.structuredContent ?? null,
    // `isError: true` is a tool that ran and failed, which is different from a
    // JSON-RPC error (the call itself failing) — that throws above.
    isError: result?.isError === true,
  };
}
