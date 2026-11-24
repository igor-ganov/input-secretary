import { matchResult } from "@input-secretary/domain-kit";
import type { McpServer } from "@modelcontextprotocol/server";
import type {
  BoundOperation,
  InvokeError,
  JsonObject,
} from "../../../shared/registry/bind-operation";

const toToolResult = matchResult<
  JsonObject,
  InvokeError,
  ReturnType<typeof success | typeof failure>
>({
  ok: (value) => success(value),
  err: (error) => failure(error),
});

const success = (value: JsonObject) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: { ...value },
});

const failure = (error: InvokeError) => ({
  content: [{ type: "text" as const, text: error }],
  isError: true,
});

export const registerTool =
  (server: McpServer) =>
  ({ contract, invoke }: BoundOperation) => {
    server.registerTool(
      contract.mcpTool,
      {
        description: contract.summary,
        inputSchema: contract.input,
        outputSchema: contract.output,
      },
      async (args) => toToolResult(await invoke(args)),
    );
  };
