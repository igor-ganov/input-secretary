import type { Result } from "@input-secretary/domain-kit";
import { err, ok } from "@input-secretary/domain-kit";

const commands = ["pair", "proton", "acp"] as const;

export type Command = (typeof commands)[number];
export type CommandError = "unknown_command";

export const parseCommand = ([name]: readonly string[]): Result<Command, CommandError> => {
  const command = commands.find((candidate) => candidate === name);
  switch (command) {
    case undefined:
      return err("unknown_command");
    default:
      return ok(command);
  }
};
