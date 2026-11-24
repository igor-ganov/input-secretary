import { describe, expect, it } from "vitest";
import { err, matchResult, ok } from "./index";

const describeResult = matchResult({
  ok: (value: number) => `ok:${value}`,
  err: (error: string) => `err:${error}`,
});

describe("Result", () => {
  it("matches a success", () => expect(describeResult(ok(1))).toBe("ok:1"));
  it("matches a failure", () => expect(describeResult(err("bad"))).toBe("err:bad"));
});
