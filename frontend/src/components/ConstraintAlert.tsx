import type { ReactNode } from "react";

type Variant = "error" | "warning" | "info";

type Props = {
  variant: Variant;
  title: string;
  children?: ReactNode;
};

const glyph: Record<Variant, string> = {
  error: "!",
  warning: "!",
  info: "i",
};

/**
 * Standalone callout for scheduling/constraint messages (empty roster, API errors, policy blocks).
 */
export function ConstraintAlert({ variant, title, children }: Props): React.ReactElement {
  const role = variant === "error" ? "alert" : "status";
  return (
    <div className={`constraint-alert constraint-alert--${variant}`} role={role}>
      <div className={`constraint-alert__glyph constraint-alert__glyph--${variant}`} aria-hidden="true">
        {glyph[variant]}
      </div>
      <div className="constraint-alert__content">
        <p className="constraint-alert__title">{title}</p>
        {children ? <div className="constraint-alert__detail">{children}</div> : null}
      </div>
    </div>
  );
}
