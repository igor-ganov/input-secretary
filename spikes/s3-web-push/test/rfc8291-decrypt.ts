// Receiver side of RFC 8291 (user agent), written independently of the library under test.
export const b64u = {
  decode: (s: string): Uint8Array =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  encode: (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
};

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
  return out;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const hmac = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
};

export type UaKeys = { readonly publicRaw: Uint8Array; readonly privateKey: CryptoKey; readonly authSecret: Uint8Array };

export const importUaPrivate = (publicRaw: Uint8Array, d: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u.encode(publicRaw.slice(1, 33)), y: b64u.encode(publicRaw.slice(33, 65)), d },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );

const stripPadding = (record: Uint8Array): Uint8Array => {
  const end = record.findLastIndex((b) => b !== 0);
  return record[end] === 2 ? record.slice(0, end) : record.slice(0, end);
};

export const decryptAes128gcm = async (body: Uint8Array, ua: UaKeys): Promise<string> => {
  const salt = body.slice(0, 16);
  const idlen = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // workers-types names the ECDH "public" member `$public`; the runtime expects `public`.
  const ecdhParams = { name: "ECDH", public: asKey };
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, ua.privateKey, 256));
  const prkKey = await hmac(ua.authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(utf8("WebPush: info\0"), ua.publicRaw, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm\0"), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce\0"), Uint8Array.of(1)))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  return new TextDecoder().decode(stripPadding(record));
};
