import { useId } from "react";
import type { ConstraintViolation, ConstraintViolationCode } from "@shiftsync/shared";
import { CONSTRAINT_RULE_TITLES } from "@shiftsync/shared";

type Props = {
  violations: ConstraintViolation[];
  /** Section heading, e.g. "Hard blocks" or "Warnings" */
  heading: string;
};

function severityLabel(severity: ConstraintViolation["severity"]): string {
  return severity === "hard" ? "Block" : "Warning";
}

function ruleTitle(code: ConstraintViolationCode): string {
  return CONSTRAINT_RULE_TITLES[code] ?? code;
}

export function ConstraintViolationCards({ violations, heading }: Props): React.ReactElement | null {
  const titleId = useId();
  if (violations.length === 0) return null;

  const hasHard = violations.some((v) => v.severity === "hard");
  const sectionRole = hasHard ? "alert" : "region";

  return (
    <div
      className={`constraint-section ${hasHard ? "constraint-section--has-hard" : ""}`}
      role={sectionRole}
      aria-labelledby={titleId}
    >
      <h3
        id={titleId}
        className={`constraint-section__title ${hasHard ? "constraint-section__title--blocking" : ""}`}
      >
        {heading}
      </h3>
      <p className="constraint-section__intro muted small">
        Each item names the <strong>rule</strong> and explains <strong>why</strong> this assignment does not pass.
      </p>
      <div className="constraint-cards" role="list" aria-label={heading}>
        {violations.map((v, i) => (
          <div
            key={`${v.code}-${i}`}
            className={`constraint-card constraint-card--${v.severity}`}
            role="listitem"
          >
            <div className="constraint-card__top">
              <span className={`constraint-card__badge constraint-card__badge--${v.severity}`}>
                {severityLabel(v.severity)}
              </span>
              <span className="constraint-card__rule">{ruleTitle(v.code)}</span>
            </div>
            <p className="constraint-card__message">{v.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
