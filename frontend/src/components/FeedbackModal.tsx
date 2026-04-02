import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export type FeedbackModalVariant = "success" | "error";

export type FeedbackModalProps = {
  open: boolean;
  variant: FeedbackModalVariant;
  title: string;
  message: string;
  onClose: () => void;
  /** Primary button label (default: OK) */
  confirmLabel?: string;
};

/** Message from a thrown Error or a fallback string. */
export function messageFromError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() ? err.message : fallback;
}

/**
 * Accessible modal for success and error feedback. Renders via portal to `document.body`.
 * Locks body scroll while open; closes on Escape, backdrop click, or confirm.
 */
export function FeedbackModal({
  open,
  variant,
  title,
  message,
  onClose,
  confirmLabel = "OK",
}: FeedbackModalProps): React.ReactElement | null {
  const titleId = useId();
  const descId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="feedback-modal-root">
      <div className="feedback-modal-backdrop" aria-hidden onClick={onClose} />
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className={`feedback-modal__icon feedback-modal__icon--${variant}`} aria-hidden>
          {variant === "success" ? "✓" : "!"}
        </div>
        <h2 id={titleId} className="feedback-modal__title">
          {title}
        </h2>
        <p id={descId} className="feedback-modal__message">
          {message}
        </p>
        <button
          ref={closeBtnRef}
          type="button"
          className="btn btn--primary feedback-modal__btn"
          onClick={onClose}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
