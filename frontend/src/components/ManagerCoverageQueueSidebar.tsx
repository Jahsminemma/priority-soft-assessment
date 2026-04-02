import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { approveCoverageRequest, fetchManagerCoverageQueue, managerAssignDropRequest } from "../api.js";
import { FeedbackModal, messageFromError } from "./FeedbackModal.js";
import type { ManagerCoverageQueueItem } from "@shiftsync/shared";

type Props = {
  token: string;
};

function shiftLines(item: ManagerCoverageQueueItem): string {
  const p = item.primaryShift;
  const lines = [`${p.locationName} · ${p.skillName}`, `${p.localDateLabel} · ${p.localTimeLabel}`];
  if (item.secondShift) {
    const s = item.secondShift;
    lines.push(`↔ ${s.locationName} · ${s.skillName}`, `${s.localDateLabel} · ${s.localTimeLabel}`);
  }
  return lines.join("\n");
}

function QueueCard({
  item,
  onApprove,
  approvingId,
  onAssign,
  assignBusyKey,
}: {
  item: ManagerCoverageQueueItem;
  onApprove: (id: string) => void;
  approvingId: string | null;
  onAssign?: (requestId: string, targetUserId: string) => void;
  /** `${requestId}-${targetUserId}` when that assign is in flight */
  assignBusyKey?: string | null;
}): React.ReactElement {
  const busy = approvingId === item.id;
  const dropModeLabel =
    item.type === "DROP" && item.status === "PENDING"
      ? item.calloutMode === "OPEN"
        ? "Open — first claim"
        : "Direct assign"
      : null;
  return (
    <li className="manager-coverage-queue__card">
      <div className="manager-coverage-queue__card-head">
        <span
          className={`manager-coverage-queue__badge${item.type === "DROP" ? " manager-coverage-queue__badge--drop" : ""}`}
        >
          {item.type === "SWAP" ? "Swap" : "Drop"}
        </span>
        <span className="manager-coverage-queue__status">
          {dropModeLabel ??
            (item.status === "PENDING"
              ? item.type === "DROP"
                ? "Open for pickup"
                : "Awaiting teammate"
              : "Ready to approve")}
        </span>
      </div>
      <p className="manager-coverage-queue__names">
        <strong>{item.requesterName}</strong>
        {item.type === "SWAP" ? " ↔ " : " → "}
        {item.targetName ?? "—"}
      </p>
      <div className="manager-coverage-queue__shift-lines">{shiftLines(item)}</div>
      {item.type === "DROP" && item.status === "PENDING" && item.expiresAt ? (
        <p className="manager-coverage-queue__meta muted">
          Offer ends {new Date(item.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      ) : null}
      {item.status === "ACCEPTED" && !item.canApprove ? (
        <p className="manager-coverage-queue__meta manager-coverage-queue__meta--warn">
          Another manager must approve this (cross-location or restricted).
        </p>
      ) : null}
      {item.status === "ACCEPTED" && item.canApprove ? (
        <button
          type="button"
          className="btn btn--primary btn--sm manager-coverage-queue__approve"
          disabled={busy}
          onClick={() => onApprove(item.id)}
        >
          {busy ? "Approving…" : "Approve"}
        </button>
      ) : null}
      {item.type === "DROP" && item.status === "PENDING" && onAssign && item.eligibleCandidates.length > 0 ? (
        <div className="manager-coverage-queue__assign">
          <p className="manager-coverage-queue__assign-label">Assign to</p>
          <div className="manager-coverage-queue__assign-btns">
            {item.eligibleCandidates.map((c) => {
              const k = `${item.id}-${c.id}`;
              const thisBusy = assignBusyKey === k;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={assignBusyKey !== null}
                  onClick={() => onAssign(item.id, c.id)}
                >
                  {thisBusy ? "…" : c.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function ManagerCoverageQueueSidebar({ token }: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["managerCoverageQueue", token],
    queryFn: () => fetchManagerCoverageQueue(token),
    enabled: Boolean(token),
    staleTime: 15_000,
  });

  const [modal, setModal] = useState<{
    variant: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const approveMut = useMutation({
    mutationFn: (requestId: string) => approveCoverageRequest(token, requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["managerCoverageQueue"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      setModal({
        variant: "success",
        title: "Approved",
        message: "The schedule is updating with the new assignment.",
      });
    },
    onError: (err) => {
      setModal({
        variant: "error",
        title: "Couldn’t approve",
        message: messageFromError(err, "Approve failed. Refresh and try again."),
      });
    },
  });

  const assignMut = useMutation({
    mutationFn: ({ requestId, targetUserId }: { requestId: string; targetUserId: string }) =>
      managerAssignDropRequest(token, requestId, targetUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["managerCoverageQueue"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["openCallouts"] });
      setModal({
        variant: "success",
        title: "Assigned",
        message: "The schedule is updating with the new assignment.",
      });
    },
    onError: (err) => {
      setModal({
        variant: "error",
        title: "Couldn’t assign",
        message: messageFromError(err, "Assign failed. Try again or pick someone else."),
      });
    },
  });

  const items = q.data ?? [];
  const readyToApprove = items.filter((i) => i.status === "ACCEPTED" && i.canApprove);
  const waitingElsewhere = items.filter((i) => i.status === "ACCEPTED" && !i.canApprove);
  const pendingSwaps = items.filter((i) => i.type === "SWAP" && i.status === "PENDING");
  const pendingDrops = items.filter((i) => i.type === "DROP" && i.status === "PENDING");
  const openCount = items.length;

  return (
    <div className="manager-coverage-queue">
      <div className="manager-coverage-queue__header">
        <div className="manager-coverage-queue__header-left">
          <span className="manager-coverage-queue__header-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </span>
          <div>
            <h2 className="manager-coverage-queue__title">Coverage queue</h2>
            <p className="manager-coverage-queue__subtitle">Swaps, drops & approvals</p>
          </div>
        </div>
        <div className="manager-coverage-queue__header-right">
          {openCount > 0 ? (
            <span className="manager-coverage-queue__count" title="Open items">
              {openCount}
            </span>
          ) : null}
          <Link to="/notifications" className="manager-coverage-queue__link-all">
            Inbox
          </Link>
        </div>
      </div>

      {q.isLoading ? (
        <div className="manager-coverage-queue__body">
          <div className="manager-coverage-queue__skeleton" aria-busy>
            <span className="manager-coverage-queue__skeleton-line" />
            <span className="manager-coverage-queue__skeleton-line manager-coverage-queue__skeleton-line--short" />
          </div>
        </div>
      ) : q.isError ? (
        <p className="manager-coverage-queue__error">Could not load coverage queue.</p>
      ) : items.length === 0 ? (
        <div className="manager-coverage-queue__empty-state">
          <span className="manager-coverage-queue__empty-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <p className="manager-coverage-queue__empty-title">All clear</p>
          <p className="manager-coverage-queue__empty-desc">
            No open swaps or shift offers. New requests will show up here and in your inbox.
          </p>
        </div>
      ) : (
        <div className="manager-coverage-queue__body">
          {readyToApprove.length > 0 ? (
            <section className="manager-coverage-queue__section" aria-labelledby="mgr-cov-approve">
              <h3 id="mgr-cov-approve" className="manager-coverage-queue__section-title">
                Ready for your approval
              </h3>
              <ul className="manager-coverage-queue__list">
                {readyToApprove.map((item) => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    onApprove={(id) => approveMut.mutate(id)}
                    approvingId={approveMut.isPending ? approveMut.variables ?? null : null}
                    onAssign={(rid, tid) => assignMut.mutate({ requestId: rid, targetUserId: tid })}
                    assignBusyKey={
                      assignMut.isPending && assignMut.variables
                        ? `${assignMut.variables.requestId}-${assignMut.variables.targetUserId}`
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {waitingElsewhere.length > 0 ? (
            <section className="manager-coverage-queue__section" aria-labelledby="mgr-cov-wait">
              <h3 id="mgr-cov-wait" className="manager-coverage-queue__section-title">
                Awaiting another manager
              </h3>
              <ul className="manager-coverage-queue__list">
                {waitingElsewhere.map((item) => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    onApprove={() => {}}
                    approvingId={null}
                    onAssign={(rid, tid) => assignMut.mutate({ requestId: rid, targetUserId: tid })}
                    assignBusyKey={
                      assignMut.isPending && assignMut.variables
                        ? `${assignMut.variables.requestId}-${assignMut.variables.targetUserId}`
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {pendingDrops.length > 0 ? (
            <section className="manager-coverage-queue__section" aria-labelledby="mgr-cov-drop">
              <h3 id="mgr-cov-drop" className="manager-coverage-queue__section-title">
                Shift offers (pickup)
              </h3>
              <ul className="manager-coverage-queue__list">
                {pendingDrops.map((item) => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    onApprove={() => {}}
                    approvingId={null}
                    onAssign={(rid, tid) => assignMut.mutate({ requestId: rid, targetUserId: tid })}
                    assignBusyKey={
                      assignMut.isPending && assignMut.variables
                        ? `${assignMut.variables.requestId}-${assignMut.variables.targetUserId}`
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {pendingSwaps.length > 0 ? (
            <section className="manager-coverage-queue__section" aria-labelledby="mgr-cov-swap">
              <h3 id="mgr-cov-swap" className="manager-coverage-queue__section-title">
                Swaps in progress
              </h3>
              <ul className="manager-coverage-queue__list">
                {pendingSwaps.map((item) => (
                  <QueueCard key={item.id} item={item} onApprove={() => {}} approvingId={null} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <FeedbackModal
        open={modal !== null}
        variant={modal?.variant ?? "success"}
        title={modal?.title ?? ""}
        message={modal?.message ?? ""}
        onClose={() => setModal(null)}
      />
    </div>
  );
}
