import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptCoverageRequest,
  approveCoverageRequest,
  cancelCoverageRequest,
  declineCoverageRequest,
  fetchNotifications,
  markNotificationReadApi,
} from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { formatNotificationForDisplay, formatNotificationTime, getNotificationRequestId } from "../utils/notificationDisplay.js";
import type { NotificationDto } from "@shiftsync/shared";
import { FeedbackModal } from "../components/FeedbackModal.js";
import { messageFromError } from "../components/FeedbackModal.js";

function notificationCardActions(
  n: NotificationDto,
  requestId: string | undefined,
  role: string | undefined,
): Array<"accept" | "reject" | "approve" | "withdraw"> {
  if (!requestId) return [];
  const p = typeof n.payload === "object" && n.payload !== null ? (n.payload as Record<string, unknown>) : {};
  const requestStatus = typeof p.requestStatus === "string" ? p.requestStatus : undefined;
  // Persistently hide actions for non-actionable requests.
  if (requestStatus && requestStatus !== "PENDING" && requestStatus !== "ACCEPTED") return [];
  if (n.type === "coverage.swap_requested" && role === "STAFF") return ["accept", "reject"];
  if (n.type === "coverage.ready_for_approval" && (role === "MANAGER" || role === "ADMIN")) return ["approve"];
  if (n.type === "coverage.accepted" && role === "STAFF") return ["withdraw"];
  return [];
}

export default function NotificationsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const role = user?.role;
  const [resolvedRequestIds, setResolvedRequestIds] = useState<Set<string>>(() => new Set());
  const [feedbackModal, setFeedbackModal] = useState<{
    variant: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["notifications", token],
    queryFn: () => fetchNotifications(token!),
    enabled: Boolean(token),
  });

  const inv = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["swapCandidates"] });
  }, [queryClient]);

  const markResolved = useCallback((rid: string) => {
    setResolvedRequestIds((prev) => {
      const next = new Set(prev);
      next.add(rid);
      return next;
    });
  }, []);

  const acceptMut = useMutation({
    mutationFn: (requestId: string) => acceptCoverageRequest(token!, requestId),
    onSuccess: (_, rid) => {
      markResolved(rid);
      setFeedbackModal({
        variant: "success",
        title: "Swap accepted",
        message: "You accepted the swap request. A manager still needs to approve before assignments change.",
      });
      inv();
    },
    onError: (err) => {
      setFeedbackModal({
        variant: "error",
        title: "Couldn’t accept",
        message: messageFromError(err, "Accept failed. Please try again."),
      });
    },
  });

  const approveMut = useMutation({
    mutationFn: (requestId: string) => approveCoverageRequest(token!, requestId),
    onSuccess: (_, rid) => {
      markResolved(rid);
      setFeedbackModal({
        variant: "success",
        title: "Approved",
        message: "You approved the request. The schedule is updating now.",
      });
      inv();
    },
    onError: (err, rid) => {
      const msg = err instanceof Error ? err.message : String(err);
      // If the request is no longer in an approvable state, treat as resolved.
      if (msg === "NOT_ACCEPTED" || msg === "NO_TARGET" || msg === "NO_ASSIGNMENT") {
        markResolved(rid);
      }
      setFeedbackModal({
        variant: "error",
        title: "Couldn’t approve",
        message: messageFromError(err, "Approve failed. Please refresh and try again."),
      });
      inv();
    },
  });

  const withdrawMut = useMutation({
    mutationFn: (requestId: string) => cancelCoverageRequest(token!, requestId),
    onSuccess: (_, rid) => {
      markResolved(rid);
      setFeedbackModal({
        variant: "success",
        title: "Request withdrawn",
        message: "You withdrew the request.",
      });
      inv();
    },
    onError: (err) => {
      setFeedbackModal({
        variant: "error",
        title: "Couldn’t withdraw",
        message: messageFromError(err, "Withdraw failed. Please try again."),
      });
    },
  });

  const rejectMut = useMutation({
    mutationFn: (requestId: string) => declineCoverageRequest(token!, requestId),
    onSuccess: (_, rid) => {
      markResolved(rid);
      setFeedbackModal({
        variant: "success",
        title: "Swap declined",
        message: "You declined the swap request. The requester will be notified.",
      });
      inv();
    },
    onError: (err, rid) => {
      const msg = err instanceof Error ? err.message : String(err);
      // If the request was already accepted/cancelled/declined elsewhere, treat as resolved.
      if (msg === "NOT_PENDING") {
        markResolved(rid);
        setFeedbackModal({
          variant: "success",
          title: "Already handled",
          message: "This swap request is no longer pending, so there’s nothing to decline.",
        });
        inv();
        return;
      }
      setFeedbackModal({
        variant: "error",
        title: "Couldn’t decline",
        message: messageFromError(err, "Decline failed. Please try again."),
      });
    },
  });

  const markRead = useCallback(
    (id: string): void => {
      if (!token) return;
      void markNotificationReadApi(token, id).then(() =>
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      );
    },
    [token, queryClient],
  );

  // Read receipt: when the user is on the Notifications page, treat all loaded unread items as read.
  // This keeps the unread badge (header + nav) in sync with what the user has seen.
  useEffect(() => {
    if (!token) return;
    if (!q.isSuccess) return;
    const unreadIds = (q.data ?? []).filter((n) => !n.readAt).map((n) => n.id);
    if (unreadIds.length === 0) return;
    void Promise.all(unreadIds.map((id) => markNotificationReadApi(token, id))).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [q.isSuccess, q.data, token, queryClient]);

  const busyFor = (rid: string): boolean =>
    (acceptMut.isPending && acceptMut.variables === rid) ||
    (approveMut.isPending && approveMut.variables === rid) ||
    (withdrawMut.isPending && withdrawMut.variables === rid) ||
    (rejectMut.isPending && rejectMut.variables === rid);

  return (
    <div className="page page--notifications">
      <FeedbackModal
        open={feedbackModal !== null}
        variant={feedbackModal?.variant ?? "success"}
        title={feedbackModal?.title ?? ""}
        message={feedbackModal?.message ?? ""}
        onClose={() => setFeedbackModal(null)}
      />
      <h1 className="page__title">Notifications</h1>
      <p className="page__lead muted">
        Updates about shifts and coverage in plain language. When you’re on this page, unread items are marked
        as read. When you can act on something, use the button on that card—no copying ids.
      </p>

      <div className="card notification-feed">
        {q.isLoading ? <p className="muted">Loading…</p> : null}
        {q.isError ? <p className="text-error">We couldn’t load your notifications. Try again.</p> : null}
        {(q.data ?? []).length === 0 && q.isSuccess ? (
          <p className="muted notification-feed__empty">You’re all caught up.</p>
        ) : null}
        <ul className="notification-list">
          {(q.data ?? []).map((n) => {
            const payloadRid = getNotificationRequestId(n.payload);
            const { title, body, requestId } = formatNotificationForDisplay(n.type, n.payload);
            const rid = requestId ?? payloadRid;
            const unread = !n.readAt;
            const actions =
              rid && resolvedRequestIds.has(rid) ? [] : notificationCardActions(n, rid, role);
            const payloadObj =
              typeof n.payload === "object" && n.payload !== null ? (n.payload as Record<string, unknown>) : {};
            const requestStatus = typeof payloadObj.requestStatus === "string" ? payloadObj.requestStatus : undefined;
            const statusLabel =
              requestStatus === "MANAGER_APPROVED"
                ? "Approved"
                : requestStatus === "DECLINED"
                  ? "Declined"
                  : requestStatus === "CANCELLED"
                    ? "Cancelled"
                    : requestStatus === "EXPIRED"
                      ? "Expired"
                      : requestStatus === "ACCEPTED"
                        ? "Accepted"
                        : requestStatus === "PENDING"
                          ? "Pending"
                          : requestStatus;
            const showStatusPill =
              Boolean(statusLabel) &&
              // only show when it helps explain why there are no actions
              actions.length === 0 &&
              (requestStatus === "MANAGER_APPROVED" ||
                requestStatus === "DECLINED" ||
                requestStatus === "CANCELLED" ||
                requestStatus === "EXPIRED");

            return (
              <li key={n.id}>
                <article
                  className={`notification-card${unread ? " notification-card--unread" : ""}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a")) return;
                    if (unread) markRead(n.id);
                  }}
                >
                  <header className="notification-card__header">
                    <div className="notification-card__title-row">
                      {unread ? <span className="notification-card__dot" aria-hidden title="Unread" /> : null}
                      <h3 className="notification-card__title">{title}</h3>
                      {showStatusPill ? (
                        <span className={`badge${requestStatus === "MANAGER_APPROVED" ? " badge--ok" : " badge--muted"}`}>
                          {statusLabel}
                        </span>
                      ) : null}
                    </div>
                    <time className="notification-card__time" dateTime={n.createdAt}>
                      {formatNotificationTime(n.createdAt)}
                    </time>
                  </header>
                  <p className="notification-card__body">{body}</p>

                  {actions.length > 0 && rid ? (
                    <div className="notification-card__actions">
                      {actions.includes("accept") ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busyFor(rid)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (unread) markRead(n.id);
                            void acceptMut.mutateAsync(rid);
                          }}
                        >
                          {acceptMut.isPending && acceptMut.variables === rid ? "Working…" : "Accept"}
                        </button>
                      ) : null}
                      {actions.includes("reject") ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busyFor(rid)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (unread) markRead(n.id);
                            void rejectMut.mutateAsync(rid);
                          }}
                        >
                          {rejectMut.isPending && rejectMut.variables === rid ? "Working…" : "Reject"}
                        </button>
                      ) : null}
                      {actions.includes("approve") ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busyFor(rid)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (unread) markRead(n.id);
                            void approveMut.mutateAsync(rid);
                          }}
                        >
                          {approveMut.isPending && approveMut.variables === rid ? "Working…" : "Approve"}
                        </button>
                      ) : null}
                      {actions.includes("withdraw") ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busyFor(rid)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (unread) markRead(n.id);
                            void withdrawMut.mutateAsync(rid);
                          }}
                        >
                          {withdrawMut.isPending && withdrawMut.variables === rid ? "Working…" : "Withdraw"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {acceptMut.isError && acceptMut.variables === rid ? (
                    <p className="text-error notification-card__inline-error">{(acceptMut.error as Error).message}</p>
                  ) : null}
                  {approveMut.isError && approveMut.variables === rid ? (
                    <p className="text-error notification-card__inline-error">{(approveMut.error as Error).message}</p>
                  ) : null}
                  {withdrawMut.isError && withdrawMut.variables === rid ? (
                    <p className="text-error notification-card__inline-error">{(withdrawMut.error as Error).message}</p>
                  ) : null}
                  {rejectMut.isError && rejectMut.variables === rid ? (
                    <p className="text-error notification-card__inline-error">{(rejectMut.error as Error).message}</p>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
