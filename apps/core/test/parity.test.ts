import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const base = "http://localhost";
// A Request built in a test has no Host header, unlike one that arrives over the network.
const send = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set("host", "localhost");
  return worker.fetch(new Request(request, { headers }), {});
};

const viaRest = async (body: unknown) => {
  const response = await send(`${base}/api/health/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const viaMcp = async (args: Record<string, unknown>) => {
  const client = new Client({ name: "parity-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { fetch: send }));
  const result = await client.callTool({ name: "health_echo", arguments: args });
  await client.close();
  return result;
};

describe("operation parity", () => {
  it("returns identical output through REST and MCP", async () => {
    const input = { message: "привет" };
    const rest = await viaRest(input);
    const mcp = await viaMcp(input);
    expect(rest).toEqual({ status: 200, body: input });
    expect(mcp.structuredContent).toEqual(rest.body);
  });

  it("rejects invalid input through both interfaces", async () => {
    const rest = await viaRest({ message: "" });
    const mcp = await viaMcp({ message: "" });
    expect(rest.status).toBe(400);
    expect(mcp.isError).toBe(true);
  });

  it("answers 400 to a REST body that is not JSON", async () => {
    const response = await send(`${base}/api/health/echo`, { method: "POST", body: "{" });
    expect(response.status).toBe(400);
  });

  it("refuses an MCP request from a foreign origin", async () => {
    const response = await send(`${base}/mcp`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });
});
