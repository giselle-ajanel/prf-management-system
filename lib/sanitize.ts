// Input normalisation for everything that crosses the API boundary.
//
// React escapes what it renders, so stored text is not an injection vector on its own. The real risks in
// this application are the places where PRF text leaves React: the CSV export (a leading =, +, - or @ turns
// a vendor name into a spreadsheet formula — guarded in the design system's csvField), the generated PDF,
// and the server's own logs. Control characters are the common thread, so they are stripped once here at
// the point of entry rather than defended against separately in each consumer.
//
// Every field the client can set passes through one of these. A value that cannot be coerced into range is
// rejected with FieldError rather than silently clamped: a truncated vendor name on a purchase order is a
// worse outcome than a failed request the user can correct.

export class FieldError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "FieldError";
  }
}

const TAB = 9, LF = 10, CR = 13;

// C0 and C1 control characters, zero-width characters, and the Unicode bidi overrides, written as code
// point ranges rather than a regex class so no literal control byte ever appears in this source file.
//
// The bidi overrides are the interesting ones: a U+202E in a description flips the text that follows it
// right-to-left, which can make "fdp.exe" render as "exe.pdf" in the approver's queue — and an approver is
// trusted to read the record accurately. Tab and newline are deliberately absent: a review note
// legitimately contains line breaks, so they are normalised below instead of stripped.
const CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],     // C0 up to backspace (tab, newline and carriage return excluded)
  [0x0b, 0x0c],     // vertical tab, form feed
  [0x0e, 0x1f],     // the rest of C0
  [0x7f, 0x9f],     // delete and the C1 block
  [0x200b, 0x200f], // zero-width space through right-to-left mark
  [0x202a, 0x202e], // bidi embedding and override
  [0x2066, 0x2069], // bidi isolate
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];

const isControl = (code: number) => CONTROL_RANGES.some(([low, high]) => code >= low && code <= high);

/** Collapses CRLF and lone CR to LF, then drops every character in CONTROL_RANGES. */
function strip(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === CR) {
      out += String.fromCharCode(LF);
      if (value.charCodeAt(index + 1) === LF) index += 1;
    } else if (!isControl(code)) {
      out += value[index];
    }
  }
  return out;
}

export const clean = (value: unknown): string =>
  typeof value === "string" ? strip(value.normalize("NFC")).trim() : "";

/** True for any whitespace character, including the tab and newline that `clean` preserves. */
const blank = (character: string) => character.trim() === "";

/** Required free text. Throws FieldError when empty or over `max`. */
export function text(value: unknown, field: string, max: number): string {
  const result = clean(value);
  if (!result) throw new FieldError(field, `${field} is required`);
  if (result.length > max) throw new FieldError(field, `${field} must be ${max} characters or fewer`);
  return result;
}

/** Optional free text. Empty is allowed; over-length still fails rather than truncating. */
export function optionalText(value: unknown, field: string, max: number): string {
  const result = clean(value);
  if (result.length > max) throw new FieldError(field, `${field} must be ${max} characters or fewer`);
  return result;
}

/** Single-line text: tabs and newlines become spaces. For names, vendors, and anything bound for a CSV cell. */
export function line(value: unknown, field: string, max: number, required = true): string {
  const flattened = Array.from(clean(value))
    .map(character => (character.charCodeAt(0) === LF || character.charCodeAt(0) === TAB ? " " : character))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!flattened && required) throw new FieldError(field, `${field} is required`);
  if (flattened.length > max) throw new FieldError(field, `${field} must be ${max} characters or fewer`);
  return flattened;
}

/** A currency amount. Rejects NaN, Infinity, negatives and anything past the app's ceiling. */
export function money(value: unknown, field: string, max = 100_000_000): number {
  const result = typeof value === "number" ? value : Number(clean(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(result)) throw new FieldError(field, `${field} must be a number`);
  if (result < 0) throw new FieldError(field, `${field} cannot be negative`);
  if (result > max) throw new FieldError(field, `${field} exceeds the maximum allowed amount`);
  return Math.round(result * 100) / 100;
}

/** A whole count, at least 1. */
export function count(value: unknown, field: string, max = 100_000): number {
  const result = typeof value === "number" ? value : Number(clean(value));
  if (!Number.isFinite(result) || result < 1) throw new FieldError(field, `${field} must be at least 1`);
  if (result > max) throw new FieldError(field, `${field} is too large`);
  return Math.floor(result);
}

/** One of a fixed set. The set is always defined server-side, never taken from the request. */
export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const result = clean(value) as T;
  if (!allowed.includes(result)) throw new FieldError(field, `${field} is not a permitted value`);
  return result;
}

/** Same as oneOf, but an empty value is allowed and returns "". */
export function optionalOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | "" {
  const result = clean(value);
  if (!result) return "";
  return oneOf<T>(result, field, allowed);
}

/** An identifier used in a store key or a URL path. Deliberately narrow: no separators, no traversal. */
export function id(value: unknown, field: string): string {
  const result = clean(value);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result)) throw new FieldError(field, `${field} is not a valid identifier`);
  return result;
}

export function email(value: unknown, field = "Email"): string {
  const result = clean(value).toLowerCase();
  const shaped = /^[^@<>"';,]{1,64}@[a-z0-9.-]{1,190}[.][a-z]{2,}$/i.test(result);
  if (!shaped || Array.from(result).some(blank)) throw new FieldError(field, "Enter a valid email address");
  return result;
}

/** Bounded array. Guards the store against a client posting a million line items. */
export function list<T>(value: unknown, field: string, max: number, map: (entry: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw new FieldError(field, `${field} must be a list`);
  if (value.length > max) throw new FieldError(field, `${field} cannot have more than ${max} entries`);
  return value.map(map);
}
