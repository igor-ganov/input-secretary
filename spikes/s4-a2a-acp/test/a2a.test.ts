import { afterAll, expect, test } from "bun:test";
import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, Role } from "@a2a-js/sdk";
import type { Message, SendMessageResult } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { serveA2A } from "../src/a2a/serve.ts";

const server = serveA2A();
afterAll(() => server.stop(true));

const isMessage = (result: SendMessageResult): result is Message => "messageId" in result;

test("serves a v1.0 agent card at the well-known path", async () => {
  const response = await fetch(new URL(AGENT_CARD_PATH, server.url));
  const card = await response.json();
  expect(response.status).toBe(200);
  expect(AGENT_CARD_PATH).toBe(".well-known/agent-card.json");
  expect(card.supportedInterfaces[0]).toMatchObject({
    protocolBinding: "JSONRPC",
    protocolVersion: A2A_PROTOCOL_VERSION,
  });
  expect(card.skills.map((skill: { id: string }) => skill.id)).toEqual(["echo"]);
});

test("echo skill answers a message through the official client", async () => {
  const client = await new ClientFactory().createFromUrl(server.url.toString());
  const result = await client.sendMessage({
    tenant: "",
    message: {
      messageId: crypto.randomUUID(),
      contextId: "",
      taskId: "",
      role: Role.ROLE_USER,
      parts: [{ content: { $case: "text", value: "hello" }, metadata: undefined, filename: "", mediaType: "text/plain" }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: undefined,
    metadata: undefined,
  });
  expect(isMessage(result)).toBe(true);
  const text = isMessage(result)
    ? result.parts.map((part) => (part.content?.$case === "text" ? part.content.value : "")).join("")
    : "";
  expect(text).toBe("echo: hello");
});

test("rejects an unsupported A2A-Version header", async () => {
  const response = await fetch(new URL("/a2a", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", "A2A-Version": "9.9" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: {} }),
  });
  const body = await response.json();
  expect(response.status).toBe(400);
  expect(body.id).toBe(1);
  expect(body.error.message).toContain("'9.9' is not supported");
});

test("a request without A2A-Version is treated as v0.3 and rejected by a v1.0-only card", async () => {
  const response = await fetch(new URL("/a2a", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "SendMessage", params: {} }),
  });
  const body = await response.json();
  expect(body.error.message).toContain("Supported versions: 1.0");
});
