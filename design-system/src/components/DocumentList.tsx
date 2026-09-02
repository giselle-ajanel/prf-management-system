"use client";

export type AttachmentRef = {
  id: string;
  name: string;
  size: number;
  /** MIME type as the server determined it from the file's own bytes. */
  type: string;
};

export type DocumentListProps = {
  attachments: AttachmentRef[];
  /**
   * Builds the link for one attachment. Omit it and the list renders as plain text — which is what a
   * static render or a caller with no download route should show, rather than a link that goes nowhere.
   */
  hrefFor?: (attachment: AttachmentRef) => string;
  /** Provide to show a remove control. Omitted on every read-only surface. */
  onRemove?: (id: string) => void;
  /** Shown when there is nothing attached. */
  empty?: string;
};

/** 1.4 MB rather than 1468006 bytes: the size is there to answer "is this the scan or the thumbnail?". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const isImage = (type: string) => type === "image/png" || type === "image/jpeg";

/**
 * The attached documents on a PRF, wherever they are shown — the editor, the approver's review, the
 * record. One component so a receipt looks and behaves the same to the person who attached it and the
 * auditor who opens it two years later.
 *
 * An image opens in a new tab to be looked at; a PDF downloads. That split is deliberate: a PDF can carry
 * script, and nothing is gained by rendering one inside the application's own origin.
 */
export function DocumentList({ attachments, hrefFor, onRemove, empty = "No documents attached." }: DocumentListProps) {
  if (!attachments.length) return <p className="muted">{empty}</p>;

  return (
    <ul className="documentList">
      {attachments.map(file => {
        const image = isImage(file.type);
        const label = (
          <>
            <span className="documentIcon" aria-hidden="true">{image ? "▤" : "▣"}</span>
            <span className="documentName">{file.name}</span>
            <span className="documentSize">{fileSize(file.size)}</span>
          </>
        );
        return (
          <li key={file.id}>
            {hrefFor ? (
              <a
                href={hrefFor(file)}
                {...(image ? { target: "_blank", rel: "noreferrer" } : { download: file.name })}
                title={image ? `Open ${file.name}` : `Download ${file.name}`}
              >
                {label}
              </a>
            ) : (
              <span className="documentStatic">{label}</span>
            )}
            {onRemove && (
              <button type="button" className="documentRemove" onClick={() => onRemove(file.id)} aria-label={`Remove ${file.name}`}>
                <span aria-hidden="true">🗑</span> Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
