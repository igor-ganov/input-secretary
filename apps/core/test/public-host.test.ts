import { describe, expect, it } from "vitest";
import worker from "../src/index";

const publicHost = "input-secretary-dev.igor-ganov.workers.dev";

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "public-host-test", version: "0.0.0" },
  },
};

const callMcp = (host: string, origin?: string) => {
  const headers = new Headers({
    host,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(origin === undefined ? {} : { origin }),
  });
  return worker.fetch(
    new Request(`https://${host}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(initialize),
    }),
    { PUBLIC_HOST: publicHost },
  );
};

describe("MCP on a deployed host", () => {
  it.each([publicHost, `pr-12-${publicHost}`])("accepts %s", async (host) => {
    expect((await callMcp(host)).status).toBe(200);
    expect((await callMcp(host, `https://${host}`)).status).toBe(200);
  });

  it.each([
    "localhost",
    "other.igor-ganov.workers.dev",
    `evil-${publicHost}`,
    `pr-x-${publicHost}`,
    `pr-12-evil-${publicHost}`,
    `${publicHost}.evil.example`,
  ])("refuses host %s", async (host) => {
    expect((await callMcp(host)).status).toBe(403);
  });

  it("refuses a foreign origin on the public host", async () => {
    expect((await callMcp(publicHost, "https://evil.example")).status).toBe(403);
  });

  it("refuses another preview as the origin of a preview", async () => {
    expect((await callMcp(`pr-12-${publicHost}`, `https://pr-13-${publicHost}`)).status).toBe(403);
  });
});
