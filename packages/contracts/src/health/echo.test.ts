import { describe, expect, it } from "vitest";
import { healthEcho, operations } from "../index";

describe("health.echo contract", () => {
  it("is declared once in the registry with its interface names", () =>
    expect(operations.map(({ name, mcpTool, rest }) => ({ name, mcpTool, rest }))).toEqual([
      {
        name: "health.echo",
        mcpTool: "health_echo",
        rest: { method: "POST", path: "/api/health/echo" },
      },
    ]));
  it("accepts a message", () =>
    expect(healthEcho.input.safeParse({ message: "hi" }).success).toBe(true));
  it.each([{}, { message: "" }, { message: 1 }, { message: "x".repeat(1001) }])(
    "rejects %j",
    (input) => expect(healthEcho.input.safeParse(input).success).toBe(false),
  );
});
