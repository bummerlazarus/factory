interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const YOUTUBE_INGEST_FUNCTION_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube-ingest`;

async function callYoutubeIngest(params: Record<string, unknown>): Promise<unknown> {
  const captureSecret = Deno.env.get("CAPTURE_SECRET");

  const response = await fetch(YOUTUBE_INGEST_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-capture-secret": captureSecret || "",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`youtube-ingest error: ${response.status} ${text}`);
  }

  return response.json();
}

function handleJsonRpc(req: JsonRpcRequest): JsonRpcResponse {
  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "youtube-ingest-mcp",
          version: "1.0.0",
        },
      },
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        tools: [
          {
            name: "youtube_ingest",
            description:
              "Ingest a YouTube video: fetch transcript, chunk, embed, and store in memory. Two-phase model: caller provides transcript text (fetched locally via yt-dlp or similar). Returns video_id, chunks_written, memory_ids, and warnings.",
            inputSchema: {
              type: "object",
              properties: {
                video_url: {
                  type: "string",
                  description:
                    'YouTube video URL (e.g., "https://www.youtube.com/watch?v=dQw4w9WgXcQ")',
                },
                video_id: {
                  type: "string",
                  description:
                    'YouTube video ID (e.g., "dQw4w9WgXcQ"). Either video_url or video_id required.',
                },
                title: {
                  type: "string",
                  description:
                    "Video title (optional, fetched via YouTube API if YOUTUBE_API_KEY set and title not provided)",
                },
                channel_name: {
                  type: "string",
                  description:
                    "Channel name (optional, fetched via YouTube API if YOUTUBE_API_KEY set and channel_name not provided)",
                },
                transcript: {
                  type: "string",
                  description:
                    'Transcript text in VTT format (with timestamps) or plain text. Required (two-phase model).',
                },
                transcript_format: {
                  type: "string",
                  enum: ["vtt", "plain"],
                  description: 'Transcript format: "vtt" for WebVTT format with timestamps, "plain" for plain text. Defaults to "plain".',
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional tags for this ingestion (e.g., [\"owned\", \"priority\"])",
                },
                force: {
                  type: "boolean",
                  description:
                    "If true, re-ingest even if video already ingested (deletes old chunks first). Defaults to false.",
                },
              },
              required: ["transcript"],
              anyOf: [{ required: ["video_url"] }, { required: ["video_id"] }],
            },
          },
        ],
      },
    };
  }

  if (req.method === "tools/call") {
    const params = req.params as { name: string; arguments: Record<string, unknown> };

    if (params.name === "youtube_ingest") {
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          isError: false,
          content: [
            {
              type: "text",
              text: "Processing YouTube ingest... (async)",
            },
          ],
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: -32601,
        message: `Unknown tool: ${params.name}`,
      },
    };
  }

  if (req.method === "notifications/initialized") {
    return {
      jsonrpc: "2.0",
    };
  }

  return {
    jsonrpc: "2.0",
    id: req.id,
    error: {
      code: -32601,
      message: `Unknown method: ${req.method}`,
    },
  };
}

Deno.serve(async (req: Request) => {
  // Discovery endpoint (GET, no auth)
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        name: "youtube-ingest-mcp",
        version: "1.0.0",
        protocol: "2025-03-26",
        transport: "streamable-http",
        endpoint: "POST JSON-RPC 2.0 payloads here with Authorization: Bearer <token>",
        tools: ["youtube_ingest"],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Auth check for POST
  const authHeader = req.headers.get("Authorization");
  const mcpAuthToken = Deno.env.get("MCP_AUTH_TOKEN");
  const captureSecret = Deno.env.get("CAPTURE_SECRET");
  const expectedToken = mcpAuthToken || captureSecret;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        reason: "missing or invalid Authorization header",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer "
  if (token !== expectedToken) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        reason: "invalid token",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Handle JSON-RPC
  if (req.method === "POST") {
    try {
      const body = await req.json() as JsonRpcRequest;

      // Handle tools/call specially — need to invoke the actual function
      if (body.method === "tools/call") {
        const params = body.params as { name: string; arguments: Record<string, unknown> };
        if (params.name === "youtube_ingest") {
          try {
            const result = await callYoutubeIngest(params.arguments);
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  isError: false,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(result, null, 2),
                    },
                  ],
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: `Error: ${message}`,
                    },
                  ],
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
        }
      }

      const response = handleJsonRpc(body);
      const statusCode = response.error ? 200 : 200;

      return new Response(JSON.stringify(response), {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Parse error";
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message,
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Handle notifications with 202 Accepted
  if (req.method === "POST") {
    return new Response(null, { status: 202 });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
});
