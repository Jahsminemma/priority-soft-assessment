import type { StaffAlternative } from "@shiftsync/shared";
import { ConstraintAlert } from "./ConstraintAlert.js";

type Props = {
  alternatives: StaffAlternative[];
  ineligibleCandidates: StaffAlternative[];
  /** When true and both lists are empty, show a short “no one else qualifies” note. */
  showEmptyPoolHint?: boolean;
};

function joinNames(names: string[]): React.ReactNode {
  if (names.length === 0) return null;
  if (names.length === 1) return <strong>{names[0]}</strong>;
  if (names.length === 2) {
    return (
      <>
        <strong>{names[0]}</strong> and <strong>{names[1]}</strong>
      </>
    );
  }
  return (
    <>
      {names.slice(0, -1).map((n, i) => (
        <span key={n}>
          {i > 0 ? ", " : ""}
          <strong>{n}</strong>
        </span>
      ))}
      , and <strong>{names[names.length - 1]}</strong>
    </>
  );
}

export function AssignmentAlternativesHint({
  alternatives,
  ineligibleCandidates,
  showEmptyPoolHint = false,
}: Props): React.ReactElement | null {
  const hasEligible = alternatives.length > 0;
  const hasIneligible = ineligibleCandidates.length > 0;

  if (!hasEligible && !hasIneligible && !showEmptyPoolHint) {
    return null;
  }

  return (
    <div className="assignment-alternatives stack">
      {hasEligible ? (
        <ConstraintAlert variant="info" title="Staff who could take this shift">
          <p className="constraint-alert__p constraint-alert__p--hint">
            {alternatives.length === 1 ? (
              <>
                <strong>{alternatives[0]!.name}</strong> has the required skill, site certification, and availability for
                this time, with no conflicting shifts.
              </>
            ) : (
              <>
                {joinNames(alternatives.map((a) => a.name))} have the required skill, site certification, and availability
                for this time, with no conflicting shifts.
              </>
            )}
          </p>
        </ConstraintAlert>
      ) : null}

      {hasIneligible ? (
        <div className="assignment-alternatives__blocked">
          <p className="assignment-alternatives__blocked-title muted small">
            Others with this skill at this location who still can’t be assigned
          </p>
          <ul className="assignment-alternatives__blocked-list" role="list">
            {ineligibleCandidates.map((c) => (
              <li key={c.staffUserId} className="assignment-alternatives__blocked-item">
                <strong>{c.name}</strong>
                <span className="muted small"> — {c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!hasEligible && !hasIneligible && showEmptyPoolHint ? (
        <p className="muted small assignment-alternatives__empty">
          No other staff with this skill and site certification currently pass every scheduling rule for this slot.
        </p>
      ) : null}
    </div>
  );
}
