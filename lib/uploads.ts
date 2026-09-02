import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FieldError } from "./sanitize";
import { storeDirectory, type StoredAttachment } from "./store";

// Supporting documents: receipts, vendor quotes, invoices, W-9s.
//
// Three checks have to agree before a file is written, because each one alone is bypassable. The browser's
// declared MIME type is a hint the client controls. The extension is a hint the filename controls. The
// leading bytes are the only claim the file makes about itself, so that is the one treated as authoritative
// — a .exe renamed to .pdf fails here even though its name and declared type both look fine.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What we accept, by the signature the bytes actually carry. */
const SIGNATURES: { type: string; extensions: string[]; magic: number[][] }[] = [
  { type: "application/pdf", extensions: [".pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },            // %PDF
  { type: "image/png", extensions: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  { type: "image/jpeg", extensions: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
];

export const ACCEPTED_TYPES = SIGNATURES.map(entry => entry.type);
export const ACCEPTED_EXTENSIONS = SIGNATURES.flatMap(entry => entry.extensions);

/** Names that must never be written, whatever the bytes say. Checked before anything else. */
const BLOCKED_EXTENSIONS = [
  ".exe", ".sh", ".bat", ".cmd", ".com", ".js", ".mjs", ".cjs", ".html", ".htm", ".svg",
  ".php", ".py", ".rb", ".jar", ".app", ".dmg", ".msi", ".scr", ".ps1", ".vbs", ".dll",
];

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  magic.every((byte, index) => bytes[index] === byte);

/**
 * Strips a filename down to something safe to store and to show.
 *
 * Directory separators, traversal, and leading dots are removed rather than escaped: the name is only ever
 * used as a label, since the file itself is stored under a generated id.
 */
export function safeFilename(value: unknown): string {
  const raw = String(value || "").normalize("NFC");
  const base = raw.split(/[\\/]/).pop() || "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ ()\-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "attachment";
}

export type AcceptedUpload = { name: string; type: string; size: number; bytes: Buffer };

/**
 * Validates one uploaded file, or throws FieldError with a sentence the requester can act on.
 *
 * Runs on the server. The browser performs the same checks before uploading so people get an immediate
 * answer, but nothing is trusted from there — this is the copy that decides.
 */
export function validateUpload(file: { name: string; type: string; size: number }, bytes: Buffer): AcceptedUpload {
  const name = safeFilename(file.name);
  const extension = (name.match(/\.[A-Za-z0-9]+$/)?.[0] || "").toLowerCase();

  if (BLOCKED_EXTENSIONS.includes(extension)) {
    throw new FieldError("File", `${name} is a program or script and cannot be attached.`);
  }
  if (!bytes.length) throw new FieldError("File", `${name} is empty.`);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new FieldError("File", `${name} is larger than 10 MB. Attach a smaller copy.`);
  }
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new FieldError("File", `${name} is not a PDF, PNG, or JPG.`);
  }

  const signature = SIGNATURES.find(entry => entry.magic.some(magic => startsWith(bytes, magic)));
  if (!signature || !signature.extensions.includes(extension)) {
    // The name says one thing and the bytes say another. That is the case worth refusing loudly.
    throw new FieldError("File", `${name} is not really a ${extension.replace(".", "").toUpperCase()} file.`);
  }

  return { name, type: signature.type, size: bytes.length, bytes };
}

const attachmentDirectory = (requestId: string) => path.join(storeDirectory(), "attachments", requestId);

/** Writes the bytes and returns the record that points at them. */
export async function writeAttachment(
  requestId: string,
  accepted: AcceptedUpload,
  uploadedBy: string,
): Promise<StoredAttachment> {
  const id = randomUUID();
  const directory = attachmentDirectory(requestId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, id), accepted.bytes, { mode: 0o600 });
  return { id, name: accepted.name, size: accepted.size, type: accepted.type, uploadedAt: new Date().toISOString(), uploadedBy };
}

export const readAttachment = (requestId: string, attachmentId: string) =>
  fs.readFile(path.join(attachmentDirectory(requestId), attachmentId));

export async function removeAttachment(requestId: string, attachmentId: string): Promise<void> {
  await fs.rm(path.join(attachmentDirectory(requestId), attachmentId), { force: true });
}
