// Joins a list of byte arrays into one Uint8Array.
export function concatBytes(parts) {
  if (parts.length === 1) return parts[0];
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
