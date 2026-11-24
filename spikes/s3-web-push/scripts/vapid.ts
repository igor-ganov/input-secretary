// Generates a VAPID key pair (P-256) and writes it to .dev.vars for `wrangler dev`.
const toB64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

await Bun.write(
  new URL("../.dev.vars", import.meta.url),
  [
    "VAPID_SUBJECT=mailto:spike@example.invalid",
    `VAPID_PUBLIC_KEY=${toB64Url(publicRaw)}`,
    `VAPID_PRIVATE_KEY=${privateJwk.d}`,
    "",
  ].join("\n"),
);
console.log("wrote .dev.vars");
