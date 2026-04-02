import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelCoverageRequest,
  createCoverageRequest,
  fetchLocations,
  fetchShiftAssignments,
  fetchShiftById,
  fetchSkills,
} from "../api.js";
import { FeedbackModal } from "../components/FeedbackModal.js";
import { StaffRequestSwapDialog } from "../components/StaffRequestSwapDialog.js";
import { useAuth } from "../context/AuthContext.js";
import {
  formatFullCalendarDateInZone,
  formatShiftDurationHuman,
  formatShiftWallTimeArrow,
} from "../utils/scheduleTime.js";
export default function StaffShiftDetailPage(): React.ReactElement {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { token, user } = useAuth();
  const isStaff = user?.role === "STAFF";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [offerOpen, setOfferOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [offerSuccessOpen, setOfferSuccessOpen] = useState(false);
  const [cancelOfferSuccessOpen, setCancelOfferSuccessOpen] = useState(false);

  const shiftQuery = useQuery({
    queryKey: ["shift", token, shiftId],
    queryFn: ({ signal }) => fetchShiftById(token!, shiftId!, signal),
    enabled: Boolean(isStaff && token && shiftId),
  });

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token && isStaff),
  });

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    queryFn: () => fetchSkills(token!),
    enabled: Boolean(token && isStaff),
  });

  const assignQuery = useQuery({
    queryKey: ["shiftAssignments", token, shiftId],
    queryFn: () => fetchShiftAssignments(token!, shiftId!),
    enabled: Boolean(isStaff && token && shiftId && shiftQuery.isSuccess),
  });

  const dropMut = useMutation({
    mutationFn: () => createCoverageRequest(token!, { type: "DROP", shiftId: shiftId! }),
    onSuccess: () => {
      setOfferOpen(false);
      setOfferSuccessOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["shift", token, shiftId] });
    },
  });

  const cancelDropMut = useMutation({
    mutationFn: (requestId: string) => cancelCoverageRequest(token!, requestId),
    onSuccess: () => {
      setOfferOpen(false);
      setCancelOfferSuccessOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["shift", token, shiftId] });
    },
  });

  if (!isStaff) {
    return (
      <div className="page">
        <h1 className="page__title">Shift</h1>
        <div className="card">
          <p className="muted">This view is for staff accounts.</p>
        </div>
      </div>
    );
  }

  const shift = shiftQuery.data;
  const loc = shift ? locationsQuery.data?.find((l) => l.id === shift.locationId) : undefined;
  const skill = shift ? skillsQuery.data?.find((s) => s.id === shift.requiredSkillId) : undefined;
  const rows = assignQuery.data ?? [];
  const coworkers = rows
    .filter((r) => r.staffUserId !== user?.id)
    .sort((a, b) => a.staffName.localeCompare(b.staffName));

  const imAssigned = Boolean(user?.id && rows.some((r) => r.staffUserId === user.id));

  return (
    <div className="page page--staff-shift-detail">
      <button
        type="button"
        className="staff-shift-detail__back"
        onClick={() => {
          // Prefer true "back" to preserve the user’s previous context (My schedule, Dashboard, Notifications, etc).
          // Fall back to the staff schedule page when there is no browser history entry.
          if (window.history.length > 1) navigate(-1);
          else navigate("/my-week");
        }}
      >
        ← Back
      </button>

      {shiftQuery.isLoading ? <p className="muted">Loading shift…</p> : null}
      {shiftQuery.isError ? (
        <p className="text-error">We couldn’t open this shift. It may have been removed or you don’t have access.</p>
      ) : null}

      {shift && loc ? (
        <>
          <header className="staff-shift-detail__head">
            <h1 className="page__title staff-shift-detail__title">Shift details</h1>
            <p className="staff-shift-detail__when">{formatFullCalendarDateInZone(shift.startAtUtc, loc.tzIana)}</p>
            <p className="staff-shift-detail__time">{formatShiftWallTimeArrow(shift.startAtUtc, shift.endAtUtc, loc.tzIana)}</p>
            <p className="staff-shift-detail__dur">{formatShiftDurationHuman(shift.startAtUtc, shift.endAtUtc)}</p>
          </header>

          <section className="card staff-shift-detail__card">
            <h2 className="staff-shift-detail__card-title">Where & role</h2>
            <p className="staff-shift-detail__loc">{loc.name}</p>
            {skill ? <p className="muted">{skill.name}</p> : null}
            <p className="muted small">Team size needed: {shift.headcount}</p>
          </section>

          <section className="card staff-shift-detail__card">
            <h2 className="staff-shift-detail__card-title">Working with</h2>
            {assignQuery.isLoading ? <p className="muted">Loading team…</p> : null}
            {assignQuery.isError ? <p className="text-error">Couldn’t load coworkers.</p> : null}
            {assignQuery.isSuccess && coworkers.length === 0 ? (
              <p className="muted">No one else is assigned yet.</p>
            ) : null}
            {coworkers.length > 0 ? (
              <ul className="staff-shift-detail__team">
                {coworkers.map((r) => (
                  <li key={r.assignmentId} className="staff-shift-detail__person">
                    <div className="staff-shift-detail__avatar" aria-hidden>
                      {r.staffName.trim()[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="staff-shift-detail__person-name">{r.staffName}</p>
                      <p className="staff-shift-detail__person-email muted small">{r.staffEmail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {imAssigned ? (
            <>
              <div className="staff-shift-detail__actions">
                {shift.pendingDropRequestId ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={cancelDropMut.isPending}
                    onClick={() => void cancelDropMut.mutateAsync(shift.pendingDropRequestId!)}
                  >
                    {cancelDropMut.isPending ? "Cancelling…" : "Cancel offer"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setOfferOpen((o) => !o)}
                    disabled={dropMut.isPending}
                  >
                    {dropMut.isPending ? "Posting…" : "Offer shift (drop)"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={Boolean(shift.pendingDropRequestId)}
                  title={
                    shift.pendingDropRequestId
                      ? "Cancel your drop offer before requesting a swap."
                      : undefined
                  }
                  onClick={() => setSwapOpen(true)}
                >
                  Request swap
                </button>
              </div>
              {shift.pendingDropRequestId ? (
                <p className="muted small staff-shift-detail__swap-blocked-hint">
                  Cancel your drop request before you can request a swap.
                </p>
              ) : null}
              {offerOpen && !shift.pendingDropRequestId ? (
                <div className="card staff-shift-detail__coverage-hint stack">
                  <p className="muted small" style={{ margin: 0 }}>
                    You stay on this shift until a manager approves coverage. If no one picks it up, the offer expires{" "}
                    <strong>24 hours before</strong> the shift starts. You can have up to <strong>three</strong> open swap
                    or drop requests at a time.
                  </p>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={dropMut.isPending}
                      onClick={() => void dropMut.mutateAsync()}
                    >
                      {dropMut.isPending ? "Posting…" : "Confirm offer"}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setOfferOpen(false)}>
                      Cancel
                    </button>
                  </div>
                  {dropMut.isError ? <p className="text-error">{(dropMut.error as Error).message}</p> : null}
                </div>
              ) : null}
              {cancelDropMut.isError ? (
                <p className="text-error staff-shift-detail__coverage-hint">{(cancelDropMut.error as Error).message}</p>
              ) : null}
            </>
          ) : null}
          {imAssigned && token && shiftId ? (
            <StaffRequestSwapDialog
              open={swapOpen}
              onClose={() => setSwapOpen(false)}
              token={token}
              shiftId={shiftId}
              pendingDropRequestId={shift.pendingDropRequestId ?? null}
            />
          ) : null}
        </>
      ) : null}

      <FeedbackModal
        open={offerSuccessOpen}
        variant="success"
        title="Offer posted"
        message="Your shift is offered for pickup. You stay assigned until a manager approves a change. If no one claims it, the offer ends 24 hours before the shift. Watch Notifications for updates."
        onClose={() => setOfferSuccessOpen(false)}
      />
      <FeedbackModal
        open={cancelOfferSuccessOpen}
        variant="success"
        title="Offer withdrawn"
        message="Your drop offer was cancelled. You remain assigned to this shift."
        onClose={() => setCancelOfferSuccessOpen(false)}
      />
    </div>
  );
}
