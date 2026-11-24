import { buildPushPayload } from "@block65/webcrypto-web-push";
import { describe, expect, it } from "vitest";
import { b64u, decryptAes128gcm, importUaPrivate } from "./rfc8291-decrypt";

// RFC 8291 Appendix A
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  // RFC 8291 Appendix A public test vector, not a secret.
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

// workers-types types generateKey/exportKey as unions; narrow them once here.
const keyPair = (k: CryptoKey | CryptoKeyPair): CryptoKeyPair => {
  if ("privateKey" in k) return k;
  throw new Error("expected a key pair");
};
const rawBytes = (k: ArrayBuffer | JsonWebKey): Uint8Array => {
  if (k instanceof ArrayBuffer) return new Uint8Array(k);
  throw new Error("expected raw key bytes");
};
const jwkOf = (k: ArrayBuffer | JsonWebKey): JsonWebKey => {
  if (k instanceof ArrayBuffer) throw new Error("expected a JWK");
  return k;
};

const generateUa = async () => {
  const pair = keyPair(await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  return {
    publicRaw: rawBytes(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: pair.privateKey,
    authSecret: crypto.getRandomValues(new Uint8Array(16)),
  };
};

const generateVapid = async () => {
  const pair = keyPair(await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]));
  const publicRaw = rawBytes(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = jwkOf(await crypto.subtle.exportKey("jwk", pair.privateKey));
  return { publicKey: pair.publicKey, keys: { subject: "mailto:t@example.invalid", publicKey: b64u.encode(publicRaw), privateKey: jwk.d ?? "" } };
};

const bodyBytes = async (body: BodyInit | null | undefined): Promise<Uint8Array> =>
  new Uint8Array(await new Response(body).arrayBuffer());

describe("RFC 8291 decryptor (reference)", () => {
  it("decrypts the RFC 8291 Appendix A example", async () => {
    const publicRaw = b64u.decode(rfc.uaPublic);
    const ua = { publicRaw, privateKey: await importUaPrivate(publicRaw, rfc.uaPrivate), authSecret: b64u.decode(rfc.authSecret) };
    expect(await decryptAes128gcm(b64u.decode(rfc.body), ua)).toBe(rfc.plaintext);
  });
});

describe("@block65/webcrypto-web-push in workerd", () => {
  it("runs inside the Workers runtime", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
  });

  it("encrypts aes128gcm that a user agent can decrypt", async () => {
    const ua = await generateUa();
    const vapid = await generateVapid();
    const subscription = {
      endpoint: "https://push.example.invalid/sub/1",
      expirationTime: null,
      keys: { p256dh: b64u.encode(ua.publicRaw), auth: b64u.encode(ua.authSecret) },
    };
    const payload = await buildPushPayload({ data: "Briefing ready: 12 items", options: { ttl: 60 } }, subscription, vapid.keys);
    const headers = new Headers(payload.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(await decryptAes128gcm(await bodyBytes(payload.body), ua)).toBe("Briefing ready: 12 items");
  });

  it("signs a VAPID JWT (RFC 8292) verifiable with the server public key", async () => {
    const ua = await generateUa();
    const vapid = await generateVapid();
    const subscription = {
      endpoint: "https://push.example.invalid/sub/2",
      expirationTime: null,
      keys: { p256dh: b64u.encode(ua.publicRaw), auth: b64u.encode(ua.authSecret) },
    };
    const payload = await buildPushPayload({ data: "x", options: { ttl: 60 } }, subscription, vapid.keys);
    const auth = new Headers(payload.headers).get("authorization") ?? "";
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
    expect(match?.[2]).toBe(vapid.keys.publicKey);
    const [h, p, s] = (match?.[1] ?? "").split(".");
    const claims: { aud: string; exp: number; sub: string } = JSON.parse(new TextDecoder().decode(b64u.decode(p ?? "")));
    expect(claims.aud).toBe("https://push.example.invalid");
    expect(claims.sub).toBe("mailto:t@example.invalid");
    expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      vapid.publicKey,
      b64u.decode(s ?? ""),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(valid).toBe(true);
  });
});
