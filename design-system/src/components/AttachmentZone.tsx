"use client";

import { useRef, useState, type DragEvent } from "react";

export type AttachmentSummary = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type AttachmentZoneProps = {
  attachments: AttachmentSummary[];
  /** Called with the chosen files. The caller uploads them and refreshes `attachments`. */
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** False before the draft exists — there is nothing to attach a file to yet. */
  enabled?: boolean;
  /** Failure text from the last upload attempt. */
  error?: string;
  busy?: boolean;
};

export const ACCEPTED_UPLOADS = ".pdf,.png,.jpg,.jpeg";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg"];

/** 1 decimal place up to MB, which is as precise as anyone needs to read a receipt's size. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The supporting-documentation zone: receipts, vendor quotes, invoices, W-9s.
 *
 * Drag and drop or browse. Files are checked here for type and size so people get an answer immediately,
 * and again on the server against the actual bytes — this copy is a courtesy, not the gate.
 *
 * ```tsx
 * <AttachmentZone attachments={files} onAdd={upload} onRemove={remove} enabled={Boolean(draftId)} />
 * ```
 */
export function AttachmentZone({ attachments, onAdd, onRemove, enabled = true, error = "", busy = false }: AttachmentZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState("");

  const take = (files: FileList | null) => {
    if (!files || !files.length) return;
    const accepted: File[] = [];
    const refused: string[] = [];
    for (const file of Array.from(files)) {
      const named = /\.(pdf|png|jpe?g)$/i.test(file.name);
      if (!named || (file.type && !ALLOWED.includes(file.type))) refused.push(`${file.name} is not a PDF, PNG, or JPG`);
      else if (file.size > MAX_BYTES) refused.push(`${file.name} is larger than 10 MB`);
      else accepted.push(file);
    }
    setRejected(refused.join(". "));
    if (accepted.length) onAdd(accepted);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (enabled && !busy) take(event.dataTransfer.files);
  };

  return (
    <section className="attachments">
      <h3>Supporting Documentation &amp; Receipts</h3>
      <div
        className={`dropZone${over ? " isOver" : ""}${enabled ? "" : " isDisabled"}`}
        onDragOver={event => {
          event.preventDefault();
          if (enabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_UPLOADS}
          hidden
          onChange={event => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
        <strong>{busy ? "Uploading…" : "Drag receipts, quotes, invoices, or a W-9 here"}</strong>
        <button type="button" className="secondary" disabled={!enabled || busy} onClick={() => input.current?.click()}>
          Browse files
        </button>
        <small>
          {enabled
            ? "PDF, PNG, or JPG · up to 10 MB each"
            : "Save this as an Open Draft first, then attach its documents"}
        </small>
      </div>

      {(error || rejected) && (
        <p className="attachmentError" role="alert">
          {error || rejected}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="attachmentList">
          {attachments.map(file => (
            <li key={file.id}>
              <span className="attachmentName">{file.name}</span>
              <span className="attachmentSize">{fileSize(file.size)}</span>
              <button type="button" className="linkButton" onClick={() => onRemove(file.id)} aria-label={`Remove ${file.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
