// Server-side temporary password generation.

const LOWER = "abcdefghijkmnopqrstuvwxyz";   // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";    // no I, O
const DIGIT = "23456789";                    // no 0, 1
const SYMBOL = "!@#$%^&*-_=+?";

/**
 * A 16-character password with at least one character from each class.
 *
 * Uses crypto.getRandomValues, never Math.random. Visually ambiguous
 * characters (l/I/1, O/0) are excluded because this password gets read off a
 * screen or an email and retyped by hand.
 *
 * Rejection sampling on the byte keeps the distribution uniform — taking
 * byte % alphabet.length would bias toward the first characters of each set.
 */
export function generatePassword(length = 16): string {
  const classes = [LOWER, UPPER, DIGIT, SYMBOL];
  const all = classes.join("");

  // One guaranteed character per class, then fill the rest from everything.
  const picks = classes.map((set) => pick(set));
  while (picks.length < length) picks.push(pick(all));

  return shuffle(picks).join("");
}

function pick(alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return alphabet[buf[0] % alphabet.length];
  }
}

/** Fisher-Yates with crypto-random indices, so class order isn't predictable. */
function shuffle(items: string[]): string[] {
  const out = [...items];
  const buf = new Uint32Array(1);
  for (let i = out.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
