import { z } from "zod";
import { defineOperation } from "../operation/define-operation";

const message = z.string().min(1).max(1000);

export const healthEcho = defineOperation({
  name: "health.echo",
  summary: "Returns the given message unchanged.",
  mcpTool: "health_echo",
  rest: { method: "POST", path: "/api/health/echo" },
  input: z.object({ message }),
  output: z.object({ message }),
});
