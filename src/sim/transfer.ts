/**
 * A colony as a piece of text you can carry somewhere else.
 *
 * `localStorage` is keyed by *origin* — scheme, host and port together. That is
 * a browser security rule, not a setting, and it means a colony saved at
 * `http://192.168.40.132:5062` is invisible at `http://192.168.40.227:5062`
 * even though it is the same game on the same machine and the same disk. A
 * DHCP lease moving overnight is enough to do it, and to the player it looks
 * exactly like the colony was deleted.
 *
 * So the save has to be able to leave. This module turns the same envelope
 * `save.ts` writes into one line of text and back again — no server, no account,
 * nothing to trust. Copy it, mail it to yourself, paste it in on the new
 * address, and the colony is there.
 *
 * The text is compressed because the honest size of a colony is about 220 kB of
 * JSON, which is enough to defeat a phone clipboard and far too much to sit in
 * a textarea comfortably. Gzipped and base64'd it is around 20 kB — still not
 * something you would read out loud, but well inside what a clipboard, a text
 * message or a mail body will carry intact.
 */

import { deserialize, type LoadResult } from './save';

/**
 * The prefix is a version *and* a format tag, and it earns its length by being
 * recognisable: a player looking at 20 kB of base64 in a note app needs one
 * glance to know what it is and that they got all of it.
 */
const GZIP = 'AETHERHOLD1:';
const PLAIN = 'AETHERHOLD0:';

/** Chunked because `String.fromCharCode(...bytes)` on 200 kB overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Compression is optional on purpose. `CompressionStream` is everywhere that
 * matters now, but an export that *throws* on an older browser is an export
 * that loses the colony it was called to rescue — so a failure here drops to
 * the uncompressed format rather than to an error, and the prefix records which
 * one came out. Import reads both regardless of what this browser can do.
 */
async function squeeze(bytes: Uint8Array, how: 'gzip' | 'gunzip'): Promise<Uint8Array | null> {
  const Ctor = how === 'gzip' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Ctor !== 'function') return null;
  try {
    const s = new Ctor('gzip');
    const written = new Blob([bytes as BlobPart]).stream().pipeThrough(s as TransformStream);
    return await drain(written as ReadableStream<Uint8Array>);
  } catch {
    return null;
  }
}

/**
 * Save text in, one line of transportable text out.
 *
 * Takes the string `serialize()` already produces rather than a World, so the
 * exported colony is byte-for-byte the colony that would have been saved — there
 * is no second definition of what a save contains to drift out of step.
 */
export async function exportColony(saveText: string): Promise<string> {
  const raw = new TextEncoder().encode(saveText);
  const gz = await squeeze(raw, 'gzip');
  return gz ? GZIP + toBase64(gz) : PLAIN + toBase64(raw);
}

/**
 * Text in, the same `LoadResult` the save slots return.
 *
 * Deliberately forgiving about what it is handed, because every step between
 * the two browsers can damage this: mail clients wrap lines, chat apps insert
 * spaces, and a player who selects the code by hand will catch a newline at
 * each end. None of that changes the colony, so none of it should be an error.
 * Raw JSON is accepted too — that is what a save looks like if somebody opens
 * the downloaded file and copies its guts instead of the whole thing.
 */
export async function importColony(text: string): Promise<LoadResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty', detail: 'nothing pasted' };
  if (trimmed.startsWith('{')) return deserialize(trimmed);

  const gz = trimmed.startsWith(GZIP);
  const plain = trimmed.startsWith(PLAIN);
  if (!gz && !plain) {
    return {
      ok: false,
      reason: 'corrupt',
      detail: 'that does not look like a colony code — it should start with AETHERHOLD',
    };
  }
  // Whitespace only after the prefix check, so the error above can still see
  // what the player actually pasted.
  const body = trimmed.slice((gz ? GZIP : PLAIN).length).replace(/\s+/g, '');
  const bytes = fromBase64(body);
  if (!bytes) return { ok: false, reason: 'corrupt', detail: 'the code is damaged or incomplete' };

  const json = gz ? await squeeze(bytes, 'gunzip') : bytes;
  if (!json) {
    return {
      ok: false,
      reason: 'corrupt',
      detail: 'could not unpack the code — it may have been cut short',
    };
  }
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(json);
  } catch (err) {
    return { ok: false, reason: 'corrupt', detail: String(err) };
  }
  return deserialize(decoded);
}

/**
 * What to call the downloaded file. Dated, because the whole reason a player is
 * here is that they are moving colonies around and a folder full of
 * `aetherhold.txt` helps nobody.
 */
export function colonyFilename(day: number, now: Date): string {
  const stamp =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}`;
  return `aetherhold-day${day}-${stamp}.txt`;
}
