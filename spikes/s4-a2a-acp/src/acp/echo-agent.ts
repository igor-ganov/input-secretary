// Minimal Agent Client Protocol (v1, stable) echo agent over stdio.
// In the product this becomes `secretary acp` in the local bridge (design §8).
import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";
import type { ContentBlock } from "@agentclientprotocol/sdk";

const textOf = (blocks: readonly ContentBlock[]): string =>
  blocks.map((block) => (block.type === "text" ? block.text : "")).join("");

export const echoAgent = () =>
  agent({ name: "input-secretary-echo" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: crypto.randomUUID() }))
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `echo: ${textOf(params.prompt)}` },
        },
      });
      return { stopReason: "end_turn" };
    });

const stdout = new WritableStream<Uint8Array>({
  write: (chunk) => {
    process.stdout.write(chunk);
  },
});

const stdin = new ReadableStream<Uint8Array>({
  start: (controller) => {
    process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
    process.stdin.on("end", () => controller.close());
  },
});

if (import.meta.main) {
  echoAgent().connect(ndJsonStream(stdout, stdin));
}
