import {
  createMcpHandler,
  hostHeaderValidationResponse,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import type { BoundOperation } from "../../../shared/registry/bind-operation";
import { allowedHostnames } from "./allowed-hostnames";
import { registerTool } from "./register-tool";

const createServer = (operations: readonly BoundOperation[]) => () => {
  const server = new McpServer({ name: "input-secretary", version: "0.0.0" });
  operations.forEach(registerTool(server));
  return server;
};

export const createMcpFetch = (operations: readonly BoundOperation[]) => {
  const handler = createMcpHandler(createServer(operations));
  return async (request: Request, publicHost: string | undefined): Promise<Response> => {
    const allowed = allowedHostnames(publicHost, new URL(request.url).hostname);
    return (
      hostHeaderValidationResponse(request, allowed) ??
      originValidationResponse(request, allowed) ??
      handler.fetch(request)
    );
  };
};
