import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCoverageRequest, fetchSwapCandidates } from "../api.js";
import { FeedbackModal } from "./FeedbackModal.js";
import { formatShiftRangeLabel } from "../utils/scheduleTime.js";

function pairKey(staffUserId: string, secondShiftId: string): string {
  return `${staffUserId}::${secondShiftId}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  shiftId: string;
};

export function StaffRequestSwapDialog({ open, onClose, token, shiftId }: Props): React.ReactElement | null {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: ["swapCandidates", token, shiftId],
    queryFn: ({ signal }) => fetchSwapCandidates(token, shiftId, signal),
    enabled: open && Boolean(token && shiftId),
  });

  useEffect(() => {
    if (!open) {
      setSelectedKey("");
      setSuccessOpen(false);
    }
  }, [open]);

  useEffect(() => {
    const rows = candidatesQuery.data?.candidates ?? [];
    if (rows.length === 0) {
      setSelectedKey("");
      return;
    }
    const first = pairKey(rows[0]!.staffUserId, rows[0]!.secondShiftId);
    setSelectedKey((cur) => {
      if (!cur) return first;
      const ok = rows.some((r) => pairKey(r.staffUserId, r.secondShiftId) === cur);
      return ok ? cur : first;
    });
  }, [candidatesQuery.data]);

  useEffect(() => {
    if (!open || successOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, successOpen, onClose]);

  const swapPayload = candidatesQuery.data;
  const rows = swapPayload?.candidates ?? [];
  const tz = swapPayload?.locationTzIana ?? "UTC";
  const selected = rows.find((r) => pairKey(r.staffUserId, r.secondShiftId) === selectedKey);

  const swapMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Pick someone to swap with.");
      return createCoverageRequest(token, {
        type: "SWAP",
        shiftId,
        targetId: selected.staffUserId,
        secondShiftId: selected.secondShiftId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["swapCandidates"] });
      setSuccessOpen(true);
    },
  });

  const handleSuccessClose = (): void => {
    setSuccessOpen(false);
    onClose();
  };

  if (!open && !successOpen) return null;

  const swapBlocked = swapPayload?.hasPendingSwapRequest === true;

  return (
    <>
      <FeedbackModal
        open={successOpen}
        variant="success"
        title="Swap request sent"
        message="You offered a true trade: your shift for theirs. They must accept, then a manager approves before assignments change. You’ll see updates in Notifications."
        onClose={handleSuccessClose}
      />
      {open && !successOpen ? (
        <div className="schedule-modal-root" role="presentation">
          <button type="button" className="schedule-modal-backdrop" aria-label="Close" onClick={onClose} />
          <div
            className="schedule-modal schedule-modal--narrow staff-swap-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-swap-dialog-title"
          >
            <div className="schedule-modal__head">
              <h2 id="staff-swap-dialog-title" className="schedule-modal__title">
                Request a shift swap
              </h2>
              <p className="muted small schedule-modal__subtitle">
                Pick a teammate whose shift you can legally take while they take yours (same schedule week; may be
                another site if you’re both certified and rules allow). Only pairs that pass scheduling rules (skills,
                site cert, availability, rest, no double booking) are listed. To give your shift away without a trade,
                use Offer shift (drop).
              </p>
              <button type="button" className="btn btn--ghost schedule-modal__close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </div>
            <div className="schedule-modal__scroll">
              {candidatesQuery.isLoading ? <p className="muted">Loading swap options…</p> : null}
              {candidatesQuery.isError ? (
                <p className="text-error">
                  {candidatesQuery.error instanceof Error ? candidatesQuery.error.message : "Could not load list."}
                </p>
              ) : null}
              {candidatesQuery.isSuccess && swapBlocked ? (
                <p className="staff-swap-modal__blocked muted" role="status">
                  You already have a <strong>swap request in progress</strong> for this shift (waiting on your teammate or a
                  manager). Withdraw it from <strong>Notifications</strong> if you need to start over.
                </p>
              ) : null}
              {candidatesQuery.isSuccess && !swapBlocked && rows.length === 0 ? (
                <p className="muted">
                  No teammate has a published shift this week you can legally trade with. Try{" "}
                  <strong>Offer shift (drop)</strong> if you only want to give your shift up for pickup.
                </p>
              ) : null}
              {rows.length > 0 ? (
                <ul
                  className={`staff-swap-modal__list${swapBlocked ? " staff-swap-modal__list--disabled" : ""}`}
                  role="listbox"
                  aria-label="Teammates and their shift you would take"
                >
                  {rows.map((r) => {
                    const key = pairKey(r.staffUserId, r.secondShiftId);
                    const sel = key === selectedKey;
                    const theirTz = r.theirShiftLocationTzIana || tz;
                    const timeLabel = formatShiftRangeLabel(
                      r.theirShiftStartAtUtc,
                      r.theirShiftEndAtUtc,
                      theirTz,
                    );
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={`staff-swap-modal__option${sel ? " staff-swap-modal__option--selected" : ""}`}
                          role="option"
                          aria-selected={sel}
                          disabled={swapBlocked}
                          onClick={() => setSelectedKey(key)}
                        >
                          <span className="staff-swap-modal__option-name">{r.staffName}</span>
                          <span className="staff-swap-modal__option-meta muted small">
                            You’d take: {r.theirShiftLocationName} · {r.theirShiftSkillName} · {timeLabel}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {swapMut.isError ? <p className="text-error">{(swapMut.error as Error).message}</p> : null}
            </div>
            <div className="schedule-modal__foot staff-swap-modal__foot">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={swapBlocked || !selected || swapMut.isPending || rows.length === 0}
                onClick={() => void swapMut.mutateAsync()}
              >
                {swapMut.isPending ? "Sending…" : "Send swap request"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
