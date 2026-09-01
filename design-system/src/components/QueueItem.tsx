"use client";

import type { Request } from "../types";
import { money, monthLabel, routeFor } from "../utils";
import { PrfNumber } from "./PrfNumber";
import { StatusPill } from "./StatusPill";

export type QueueItemProps = {
  request: Request;
  onOpen: (request: Request) => void;
};

/**
 * One row in the approval queue: status, coding trail, purpose, total, and where it routes next.
 *
 * An approved request shows the month it cleared instead of its next approver, and its action reads
 * "View approval" rather than "Review request".
 *
 * ```tsx
 * <div className="queueList">
 *   {queue.map(request => <QueueItem key={request.id} request={request} onOpen={setSelected} />)}
 * </div>
 * ```
 */
export function QueueItem({ request, onOpen }: QueueItemProps) {
  const isApproved = request.status === "Approved";
  return (
    <article className="queueItem">
      <div>
        <StatusPill status={request.status} />
        <PrfNumber id={request.id} paymentType={request.paymentType} />
        <small>
          {request.district} · {request.school}
        </small>
        <h3>{request.description}</h3>
        <p>
          {request.vendor} · Requested by {request.requester}
        </p>
      </div>
      <div>
        <strong>{money(request.amount)}</strong>
        <small>
          {isApproved && request.approvedAt
            ? `Approved ${monthLabel(request.approvedAt.slice(0, 7))}`
            : `Routes to ${routeFor(request.amount)}`}
        </small>
        <button onClick={() => onOpen(request)}>{isApproved ? "View approval" : "Review request"} →</button>
      </div>
    </article>
  );
}
