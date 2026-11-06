/** Verify a WebAuthn assertion against the SPKI key saved by the legacy registration flow. */
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}

function derEcdsaToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('Invalid DER signature');
  let i = 2;
  const parseInteger = () => {
    if (der[i++] !== 2) throw new Error('Invalid DER integer');
    const length = der[i++];
    if (!length || length > 33 || i + length > der.length) throw new Error('Invalid DER integer length');
    let value = der.slice(i, i + length); i += length;
    if (value[0] & 0x80) throw new Error('Negative DER integer');
    if (value.length > 1 && value[0] === 0) {
      if (!(value[1] & 0x80)) throw new Error('Noncanonical DER integer');
      value = value.slice(1);
    }
    if (value.length > 32) throw new Error('DER integer too large');
    const padded = new Uint8Array(32); padded.set(value, 32 - value.length); return padded;
  };
  const r = parseInteger(); const s = parseInteger();
  if (i !== der.length) throw new Error('Trailing DER data');
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32); return raw;
}

export async function verifyLegacyAssertion(input: {
  challenge: string; clientDataJSON: string; authenticatorData: string; signature: string;
  publicKey: string; origin: string; rpId: string; previousCounter: number;
}): Promise<{ valid: boolean; counter: number }> {
  const invalid = { valid: false, counter: 0 };
  try {
    const clientData = decode(input.clientDataJSON);
    const client = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientData));
    if (client.type !== 'webauthn.get' || client.challenge !== input.challenge || client.origin !== input.origin || client.crossOrigin === true) return invalid;
    const authenticator = decode(input.authenticatorData);
    if (authenticator.length < 37 || !(authenticator[32] & 1) || !(authenticator[32] & 4)) return invalid;
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.rpId)));
    if (!rpHash.every((byte, index) => byte === authenticator[index])) return invalid;
    const counter = new DataView(authenticator.buffer, authenticator.byteOffset, authenticator.byteLength).getUint32(33);
    if ((counter !== 0 || input.previousCounter !== 0) && counter <= input.previousCounter) return invalid;
    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
    const signed = new Uint8Array(authenticator.length + clientHash.length); signed.set(authenticator); signed.set(clientHash, authenticator.length);
    const spki = decode(input.publicKey); const signature = decode(input.signature);
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch {
      key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    }
    const isEc = key.algorithm.name === 'ECDSA';
    const verified = await crypto.subtle.verify(isEc ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, isEc ? derEcdsaToRaw(signature) : signature, signed);
    return { valid: verified, counter: verified ? counter : 0 };
  } catch { return invalid; }
}
