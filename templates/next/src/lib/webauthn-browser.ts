// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Browser-side WebAuthn glue: base64url <-> bytes conversion around
 * navigator.credentials. The platform's options are JSON (base64url fields,
 * as produced by @simplewebauthn/server); the browser API wants ArrayBuffers.
 * No library needed beyond this file.
 */

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Prefer the browser-native serializer (WebAuthn L3); fall back manually. */
function credToJSON(cred: any): unknown {
  if (typeof cred.toJSON === "function") return cred.toJSON();
  const out: any = {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  if (cred.response.attestationObject) {
    out.response = {
      clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
      attestationObject: bytesToB64url(cred.response.attestationObject),
      transports: (cred.response.getTransports && cred.response.getTransports()) || [],
    };
  } else {
    out.response = {
      clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
      authenticatorData: bytesToB64url(cred.response.authenticatorData),
      signature: bytesToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bytesToB64url(cred.response.userHandle) : null,
    };
  }
  return out;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
}

/** Run the registration ceremony. Returns the serialized credential. */
export async function webauthnCreate(optionsJson: any): Promise<unknown> {
  const opts = JSON.parse(JSON.stringify(optionsJson));
  opts.challenge = b64urlToBytes(optionsJson.challenge);
  opts.user.id = b64urlToBytes(optionsJson.user.id);
  if (opts.excludeCredentials) {
    opts.excludeCredentials = opts.excludeCredentials.map((c: any) => ({
      ...c,
      id: b64urlToBytes(c.id),
    }));
  }
  const cred = await navigator.credentials.create({ publicKey: opts });
  return credToJSON(cred);
}

/** Run the authentication ceremony. Returns the serialized credential. */
export async function webauthnGet(optionsJson: any): Promise<unknown> {
  const opts = JSON.parse(JSON.stringify(optionsJson));
  opts.challenge = b64urlToBytes(optionsJson.challenge);
  if (opts.allowCredentials) {
    opts.allowCredentials = opts.allowCredentials.map((c: any) => ({
      ...c,
      id: b64urlToBytes(c.id),
    }));
  }
  const cred = await navigator.credentials.get({ publicKey: opts });
  return credToJSON(cred);
}
