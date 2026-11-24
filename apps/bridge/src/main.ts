#!/usr/bin/env bun
import { matchResult } from "@input-secretary/domain-kit";
import type { Command, CommandError } from "./cli/parse-command";
import { parseCommand } from "./cli/parse-command";

const report = matchResult<Command, CommandError, { text: string; code: number }>({
  ok: (command) => ({ text: `secretary ${command}: not implemented yet\n`, code: 1 }),
  err: () => ({ text: "usage: secretary <pair|proton|acp>\n", code: 2 }),
});

const { text, code } = report(parseCommand(Bun.argv.slice(2)));
process.stderr.write(text);
process.exitCode = code;
