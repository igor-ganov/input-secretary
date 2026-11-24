// Runs the whole S3 check with bun as the only JS runtime. `wrangler dev` answers 503 under
// bun 1.4.5 on Windows, so the Worker is bundled by Bun.build and served by Miniflare (workerd).
// Usage: bun --bun scripts/bun-only-e2e.ts <outDir>
import { readFileSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const PORT = 8799;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const outDir = process.argv[2] ?? ".";
const cwd = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const parseVars = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
      }),
  );

const build = await Bun.build({ entrypoints: [`${cwd}/src/index.ts`], target: "browser", format: "esm" });
const script = await build.outputs[0]?.text();
if (!build.success || script === undefined) throw new Error("worker bundle failed");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1",
  port: PORT,
  workers: [
    {
      name: "spike-s3-web-push",
      modules: [{ type: "ESModule", path: "index.mjs", contents: script }],
      compatibilityDate: "2026-11-01",
      bindings: parseVars(readFileSync(`${cwd}/.dev.vars`, "utf8")),
    },
  ],
}));

const deliver = async (browser: string): Promise<number> =>
  Bun.spawn([process.execPath, "--bun", "scripts/deliver.ts", browser, outDir], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, SPIKE_ORIGIN: ORIGIN, PUSH_WAIT_MS: "60000" },
  }).exited;

const main = async (): Promise<number> => {
  await miniflare.ready;
  const chrome = await deliver("chrome");
  const firefox = await deliver("firefox");
  process.stdout.write(`runtime=bun ${Bun.version} worker=miniflare chrome=${chrome} firefox=${firefox}\n`);
  return chrome + firefox;
};

const code = await main().catch((e: unknown) => {
  process.stdout.write(`FAILED ${String(e)}\n`);
  return 1;
});
await miniflare.dispose();
process.exit(code === 0 ? 0 : 1);
