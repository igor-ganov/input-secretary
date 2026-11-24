import { afterAll, expect, test } from "bun:test";
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from "@agentclientprotocol/sdk";
import { fileURLToPath } from "node:url";

const agentPath = fileURLToPath(new URL("../src/acp/echo-agent.ts", import.meta.url));
const child = Bun.spawn(["bun", "run", agentPath], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
afterAll(() => child.kill());

const toAgent = new WritableStream<Uint8Array>({
  write: (chunk) => {
    child.stdin.write(chunk);
  },
  close: () => {
    child.stdin.end();
  },
});

test("echo agent answers a prompt over stdio through the official client", async () => {
  const text = await client({ name: "spike-client" }).connectWith(
    ndJsonStream(toAgent, child.stdout),
    async (agent) => {
      const init = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      expect(init.protocolVersion).toBe(PROTOCOL_VERSION);
      return agent.buildSession(process.cwd()).withSession(async (session) => {
        const response = await session.prompt("hello");
        expect(response.stopReason).toBe("end_turn");
        return session.readText();
      });
    },
  );
  expect(text).toBe("echo: hello");
});
