// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The base64url <-> bytes glue around navigator.credentials. The platform
 * sends JSON with base64url fields; the browser API wants ArrayBuffers; the
 * credential that comes back must go the other way. Both directions are
 * pinned with known byte sequences, not just round-trips.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { passkeysSupported, webauthnCreate, webauthnGet } from "./webauthn-browser";

/* eslint-disable @typescript-eslint/no-explicit-any */
type CeremonyFn = (opts: { publicKey: any }) => Promise<any>;

// "hello" in base64url, and the bytes it decodes to.
const HELLO_B64URL = "aGVsbG8";
const HELLO = new Uint8Array([104, 101, 108, 108, 111]);
// Bytes whose standard base64 contains '+' and '/', so the url-safe mapping
// is actually exercised: 0xfb 0xff -> "+/8" -> "-_8".
const TRICKY = new Uint8Array([0xfb, 0xff]);

const bytes = (b: ArrayBuffer) => new Uint8Array(b);

afterEach(() => vi.unstubAllGlobals());

describe("passkeysSupported", () => {
  it("needs a window with PublicKeyCredential", () => {
    expect(passkeysSupported()).toBe(false);
    vi.stubGlobal("window", {});
    expect(passkeysSupported()).toBe(false);
    vi.stubGlobal("window", { PublicKeyCredential: function PublicKeyCredential() {} });
    expect(passkeysSupported()).toBe(true);
  });
});

describe("webauthnCreate", () => {
  it("decodes the challenge, user id and exclusion list to bytes, and serialises the credential", async () => {
    const create = vi.fn<CeremonyFn>(async () => ({
      id: "cred-1",
      rawId: HELLO.buffer,
      type: "public-key",
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: HELLO.buffer,
        attestationObject: TRICKY.buffer,
        getTransports: () => ["internal"],
      },
    }));
    vi.stubGlobal("navigator", { credentials: { create } });

    const out = await webauthnCreate({
      challenge: HELLO_B64URL,
      user: { id: HELLO_B64URL, name: "a@b.c" },
      excludeCredentials: [{ id: HELLO_B64URL, type: "public-key" }],
    });

    const sent = create.mock.calls[0]![0].publicKey;
    expect(bytes(sent.challenge)).toEqual(HELLO);
    expect(bytes(sent.user.id)).toEqual(HELLO);
    expect(sent.user.name).toBe("a@b.c");
    expect(bytes(sent.excludeCredentials[0].id)).toEqual(HELLO);
    expect(sent.excludeCredentials[0].type).toBe("public-key");

    expect(out).toEqual({
      id: "cred-1",
      rawId: HELLO_B64URL,
      type: "public-key",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: HELLO_B64URL,
        attestationObject: "-_8",
        transports: ["internal"],
      },
    });
  });

  it("copes without an exclusion list, transports, or extension results", async () => {
    const create = vi.fn<CeremonyFn>(async () => ({
      id: "cred-1",
      rawId: HELLO.buffer,
      type: "public-key",
      response: { clientDataJSON: HELLO.buffer, attestationObject: HELLO.buffer },
    }));
    vi.stubGlobal("navigator", { credentials: { create } });

    const out = (await webauthnCreate({ challenge: HELLO_B64URL, user: { id: HELLO_B64URL } })) as {
      clientExtensionResults: unknown;
      response: { transports: unknown };
    };

    expect(create.mock.calls[0]![0].publicKey.excludeCredentials).toBeUndefined();
    expect(out.clientExtensionResults).toEqual({});
    expect(out.response.transports).toEqual([]);
  });

  it("prefers the browser's own toJSON when the credential has one", async () => {
    const native = { id: "native", response: {} };
    const create = vi.fn<CeremonyFn>(async () => ({ toJSON: () => native }));
    vi.stubGlobal("navigator", { credentials: { create } });
    expect(await webauthnCreate({ challenge: HELLO_B64URL, user: { id: HELLO_B64URL } })).toBe(native);
  });
});

describe("webauthnGet", () => {
  it("decodes the challenge and allow-list, and serialises an assertion with its user handle", async () => {
    const get = vi.fn<CeremonyFn>(async () => ({
      id: "cred-1",
      rawId: HELLO.buffer,
      type: "public-key",
      response: {
        clientDataJSON: HELLO.buffer,
        authenticatorData: HELLO.buffer,
        signature: TRICKY.buffer,
        userHandle: HELLO.buffer,
      },
    }));
    vi.stubGlobal("navigator", { credentials: { get } });

    const out = await webauthnGet({
      challenge: HELLO_B64URL,
      allowCredentials: [{ id: HELLO_B64URL, type: "public-key" }],
    });

    const sent = get.mock.calls[0]![0].publicKey;
    expect(bytes(sent.challenge)).toEqual(HELLO);
    expect(bytes(sent.allowCredentials[0].id)).toEqual(HELLO);
    expect(out).toMatchObject({
      response: {
        clientDataJSON: HELLO_B64URL,
        authenticatorData: HELLO_B64URL,
        signature: "-_8",
        userHandle: HELLO_B64URL,
      },
    });
  });

  it("sends no allow-list when the platform gave none, and nulls a missing user handle", async () => {
    const get = vi.fn<CeremonyFn>(async () => ({
      id: "cred-1",
      rawId: HELLO.buffer,
      type: "public-key",
      response: {
        clientDataJSON: HELLO.buffer,
        authenticatorData: HELLO.buffer,
        signature: HELLO.buffer,
        userHandle: null,
      },
    }));
    vi.stubGlobal("navigator", { credentials: { get } });

    const out = (await webauthnGet({ challenge: HELLO_B64URL })) as { response: { userHandle: unknown } };

    expect(get.mock.calls[0]![0].publicKey.allowCredentials).toBeUndefined();
    expect(out.response.userHandle).toBeNull();
  });
});

describe("base64url handling", () => {
  it("pads unpadded input correctly for every remainder", async () => {
    // 1, 2 and 3 bytes need 2, 1 and 0 padding characters respectively.
    const cases: Array<[string, number[]]> = [
      ["YQ", [97]],
      ["YWI", [97, 98]],
      ["YWJj", [97, 98, 99]],
    ];
    for (const [b64url, raw] of cases) {
      const get = vi.fn<CeremonyFn>(async () => ({
        id: "x",
        rawId: new Uint8Array(raw).buffer,
        type: "public-key",
        response: {
          clientDataJSON: HELLO.buffer,
          authenticatorData: HELLO.buffer,
          signature: HELLO.buffer,
          userHandle: null,
        },
      }));
      vi.stubGlobal("navigator", { credentials: { get } });
      const out = (await webauthnGet({ challenge: b64url })) as { rawId: string };
      expect(bytes(get.mock.calls[0]![0].publicKey.challenge)).toEqual(new Uint8Array(raw));
      expect(out.rawId).toBe(b64url); // and back again, without padding
    }
  });
});
