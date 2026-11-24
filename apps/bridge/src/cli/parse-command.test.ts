import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse-command";

describe("parseCommand", () => {
  it.each(["pair", "proton", "acp"])("accepts %s", (name) =>
    expect(parseCommand([name])).toEqual({ kind: "ok", value: name }),
  );
  it("rejects an unknown command", () =>
    expect(parseCommand(["nope"])).toEqual({ kind: "err", error: "unknown_command" }));
  it("rejects a missing command", () =>
    expect(parseCommand([])).toEqual({ kind: "err", error: "unknown_command" }));
});
