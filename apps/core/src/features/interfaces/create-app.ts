import { Hono } from "hono";
import type { Bindings } from "../../shared/bindings";
import type { BoundOperation } from "../../shared/registry/bind-operation";
import { createMcpFetch } from "./mcp/create-mcp-fetch";
import { mountRest } from "./rest/mount-rest";

export const createApp = (operations: readonly BoundOperation[]) => {
  const app = new Hono<{ Bindings: Bindings }>();
  const mcp = createMcpFetch(operations);
  operations.forEach(mountRest(app));
  app.all("/mcp", (context) => mcp(context.req.raw, context.env.PUBLIC_HOST));
  return app;
};
