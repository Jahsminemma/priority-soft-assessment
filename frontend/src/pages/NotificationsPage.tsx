import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptCoverageRequest,
  approveCoverageRequest,
  cancelCoverageRequest,
  fetchNotifications,
  markNotificationReadApi,
} from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { formatNotificationForDisplay, formatNotificationTime, getNotificationRequestId } from "../utils/notificationDisplay.js";
import type { NotificationDto } from "@shiftsync/shared";

function notificationCardActions(
  n: NotificationDto,
  requestId: string | undefined,
  role: string | undefined,
): "accept" | "approve" | "withdraw" | null {
  if (!requestId) return null;
  if (n.type === "coverage.swap_requested" && role === "STAFF") return "accept";
  if (n.type === "coverage.ready_for_approval" && (role === "MANAGER" || role === "ADMIN")) return "approve";
  if (n.type === "coverage.accepted" && role === "STAFF") return "withdraw";
  return null;
}

export default function NotificationsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const role = user?.role;

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

  const acceptMut = useMutation({
    mutationFn: (requestId: string) => acceptCoverageRequest(token!, requestId),
    onSuccess: inv,
  });

  const approveMut = useMutation({
    mutationFn: (requestId: string) => approveCoverageRequest(token!, requestId),
    onSuccess: inv,
  });

  const withdrawMut = useMutation({
    mutationFn: (requestId: string) => cancelCoverageRequest(token!, requestId),
    onSuccess: inv,
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
    (withdrawMut.isPending && withdrawMut.variables === rid);

  return (
    <div className="page page--notifications">
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
            const action = notificationCardActions(n, rid, role);

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
                    </div>
                    <time className="notification-card__time" dateTime={n.createdAt}>
                      {formatNotificationTime(n.createdAt)}
                    </time>
                  </header>
                  <p className="notification-card__body">{body}</p>

                  {action && rid ? (
                    <div className="notification-card__actions">
                      {action === "accept" ? (
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
                      {action === "approve" ? (
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
                      {action === "withdraw" ? (
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
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
