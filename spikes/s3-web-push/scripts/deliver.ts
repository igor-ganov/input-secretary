// Real delivery check: subscribe in a real browser, push from the local Worker, wait for the
// service worker to hand the payload to the page. Usage: bun scripts/deliver.ts <chrome|firefox> <outDir>
import { chromium, firefox, type BrowserContext } from "playwright";

const ORIGIN = process.env.SPIKE_ORIGIN ?? "http://127.0.0.1:8787";
const CEILING_MS = Number(process.env.PUSH_WAIT_MS ?? 30000);
const [which = "chrome", outDir = "."] = process.argv.slice(2);
const profile = `${outDir}/profile-${which}-${Date.now()}`;

const launchers: Readonly<Record<string, () => Promise<BrowserContext>>> = {
  chrome: () => chromium.launchPersistentContext(profile, { channel: "chrome", headless: false, args: ["--window-position=-2400,0"] }),
  firefox: () =>
    firefox.launchPersistentContext(profile, {
      headless: process.env.FIREFOX_HEADED !== "1",
      firefoxUserPrefs: {
        "dom.push.enabled": true,
        "dom.push.connection.enabled": true,
        // Playwright Firefox ships with push disabled (serverURL "" + connection off); restore Mozilla autopush.
        "dom.push.serverURL": "wss://push.services.mozilla.com/",
        "dom.serviceWorkers.enabled": true,
        "permissions.default.desktop-notification": 1,
      },
    }),
};

const launch = launchers[which];
if (!launch) throw new Error(`unknown browser ${which}`);
const context = await launch();
await context.grantPermissions(["notifications"], { origin: ORIGIN }).catch((e: unknown) => console.log("grantPermissions:", String(e)));
const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (m) => console.log(`[${which} console] ${m.text()}`));
await page.goto(ORIGIN);
await page.click("#subscribe");
await page.waitForFunction(() => document.getElementById("subscription")?.textContent !== "none", undefined, { timeout: CEILING_MS });
const subscribedTo = await page.textContent("#subscription");
console.log(`${which}: subscription -> ${subscribedTo}`);

const text = `briefing-${which}-${Date.now()}`;
const sent = await (await fetch(`${ORIGIN}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })).json();
console.log(`${which}: send ->`, JSON.stringify(sent));
await page.waitForFunction((t) => document.body.dataset.pushReceived === t, text, { timeout: CEILING_MS });
console.log(`${which}: RECEIVED ${text}`);
await page.screenshot({ path: `${outDir}/s3-${which}-received.png` });
await context.close();
