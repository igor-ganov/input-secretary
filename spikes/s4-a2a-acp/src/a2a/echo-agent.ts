// Minimal A2A v1.0 echo agent as a Web-standard fetch handler.
// Uses only the transport-agnostic parts of @a2a-js/sdk (no express),
// so the same handler can be mounted in a Cloudflare Worker.
import {
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  AGENT_CARD_PATH,
  Role,
  SSE_HEADERS,
  formatSSEEvent,
} from "@a2a-js/sdk";
import type { AgentCard, Message, Part } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  UnauthenticatedUser,
  defaultServerCallContextBuilder,
  validateVersion,
} from "@a2a-js/sdk/server";
import type { AgentExecutor } from "@a2a-js/sdk/server";

export const RPC_PATH = "/a2a";

const textPart = (value: string): Part => ({
  content: { $case: "text", value },
  metadata: undefined,
  filename: "",
  mediaType: "text/plain",
});

const textOf = (message: Message): string =>
  message.parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join("");

export const agentCard = (baseUrl: string): AgentCard => ({
  name: "Echo Secretary (spike)",
  description: "Spike S4: echoes the text it receives.",
  version: "0.0.1",
  provider: { organization: "input-secretary spike", url: baseUrl },
  supportedInterfaces: [
    {
      url: new URL(RPC_PATH, baseUrl).toString(),
      protocolBinding: "JSONRPC",
      protocolVersion: A2A_PROTOCOL_VERSION,
      tenant: "",
    },
  ],
  capabilities: { streaming: true, pushNotifications: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "echo",
      name: "Echo",
      description: "Returns the text of the incoming message.",
      tags: ["spike"],
      examples: ["hello"],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      securityRequirements: [],
    },
  ],
  signatures: [],
});

const echoExecutor: AgentExecutor = {
  execute: async (ctx, bus) => {
    bus.publish(
      AgentEvent.message({
        messageId: crypto.randomUUID(),
        contextId: ctx.contextId,
        taskId: "",
        role: Role.ROLE_AGENT,
        parts: [textPart(`echo: ${textOf(ctx.userMessage)}`)],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      }),
    );
    bus.finished();
  },
  cancelTask: async () => undefined,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sseResponse = (stream: AsyncGenerator<unknown>): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const encoder = new TextEncoder();
        for await (const event of stream) {
          controller.enqueue(encoder.encode(formatSSEEvent(event)));
        }
        controller.close();
      },
    }),
    { headers: SSE_HEADERS },
  );

const isStream = (value: unknown): value is AsyncGenerator<unknown> =>
  Symbol.asyncIterator in Object(value);

const rpcError = (error: unknown, id: unknown): Response =>
  json({ jsonrpc: "2.0", id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) }, 400);

const requestId = (body: string): unknown => {
  try {
    return JSON.parse(body).id;
  } catch {
    return undefined;
  }
};

export const createA2AHandler = (baseUrl: string) => {
  const card = agentCard(baseUrl);
  const requestHandler = new DefaultRequestHandler(card, new InMemoryTaskStore(), echoExecutor);
  const transport = new JsonRpcTransportHandler(requestHandler);

  const handleRpc = async (request: Request): Promise<Response> => {
    const body = await request.text();
    const version = request.headers.get(A2A_VERSION_HEADER);
    const context = defaultServerCallContextBuilder({
      extensions: undefined,
      user: new UnauthenticatedUser(),
      headers: Object.fromEntries(request.headers),
      // Absent header means the client speaks v0.3; the SDK builder maps a missing key to "0.3".
      ...(version ? { requestedVersion: version } : {}),
    });
    try {
      validateVersion(context.requestedVersion, card, "JSONRPC");
      const result = await transport.handle(body, context);
      return isStream(result) ? sseResponse(result) : json(result);
    } catch (error) {
      return rpcError(error, requestId(body));
    }
  };

  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    switch (`${request.method} ${pathname}`) {
      case `GET /${AGENT_CARD_PATH}`:
        return json(card);
      case `POST ${RPC_PATH}`:
        return handleRpc(request);
      default:
        return json({ error: "not found" }, 404);
    }
  };
};
