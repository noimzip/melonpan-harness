import { describe, expect, it } from 'vitest';
import { verifyLegacyAssertion } from '../../../supabase/functions/kosen-ai-proxy/webauthn-assertion';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
function der(raw: Uint8Array): Uint8Array {
  const part = (value: Uint8Array) => {
    let i = 0; while (i < value.length - 1 && value[i] === 0) i++;
    const v = Array.from(value.slice(i)); if (v[0] & 128) v.unshift(0);
    return [2, v.length, ...v];
  };
  const body = [...part(raw.slice(0, 32)), ...part(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
async function fixture() {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', key.publicKey));
  const challenge = 'challenge_123'; const origin = 'https://melonpan-kosen.vercel.app'; const rpId = 'melonpan-kosen.vercel.app';
  const client = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
  const auth = new Uint8Array(37); auth.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)))); auth[32] = 5; auth[36] = 1;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client)); const signed = new Uint8Array(69); signed.set(auth); signed.set(hash, 37);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, signed));
  return { challenge, origin, rpId, previousCounter: 0, clientDataJSON: b64(client), authenticatorData: b64(auth), signature: b64(der(raw)), publicKey: b64(publicKey) };
}
describe('legacy WebAuthn assertion verification', () => {
  it('accepts a real signed assertion and rejects a forged signature', async () => {
    const f = await fixture();
    expect(await verifyLegacyAssertion(f)).toEqual({ valid: true, counter: 1 });
    expect((await verifyLegacyAssertion({ ...f, signature: 'invalid' })).valid).toBe(false);
  });
  it('rejects wrong challenge, origin, relying party, counter replay, and missing verification', async () => {
    const f = await fixture();
    expect((await verifyLegacyAssertion({ ...f, challenge: 'other' })).valid).toBe(false);
    expect((await verifyLegacyAssertion({ ...f, origin: 'https://evil.example' })).valid).toBe(false);
    expect((await verifyLegacyAssertion({ ...f, rpId: 'evil.example' })).valid).toBe(false);
    expect((await verifyLegacyAssertion({ ...f, previousCounter: 1 })).valid).toBe(false);
    const auth = Buffer.from(f.authenticatorData, 'base64url'); auth[32] = 1;
    expect((await verifyLegacyAssertion({ ...f, authenticatorData: b64(auth) })).valid).toBe(false);
  });
});

describe('staff session tokens', () => {
  it('accepts only current signed tokens and rejects old or forged sessions', async () => {
    const { generateHmacSignature, verifyHmacToken } = await import('../../../supabase/functions/kosen-ai-proxy/staff-session');
    const secret = 'a-test-only-long-random-secret';
    const make = async (version: number, timestamp: number) => {
      const payload = Buffer.from(JSON.stringify({ email: 'staff@kosen.local', version })).toString('base64url');
      const message = `${payload}.${timestamp}`;
      return `${message}.${await generateHmacSignature(message, secret)}`;
    };
    const valid = await make(2, Date.now());
    expect((await verifyHmacToken(valid, secret)).valid).toBe(true);
    expect((await verifyHmacToken(await make(1, Date.now()), secret)).valid).toBe(false);
    expect((await verifyHmacToken(await make(2, Date.now() - 9 * 60 * 60 * 1000), secret)).valid).toBe(false);
    expect((await verifyHmacToken(await make(2, Date.now() + 60_000), secret)).valid).toBe(false);
    expect((await verifyHmacToken(valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0'), secret)).valid).toBe(false);
  });
});
