/** Human-readable copy for in-app notifications (payloads stay JSON in the API). */

export type NotificationDisplay = {
  title: string;
  body: string;
  /** Present when the payload includes a coverage request id (for in-card actions). */
  requestId?: string;
};

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Coverage / workflow request id from a notification payload, if any. */
export function getNotificationRequestId(payload: unknown): string | undefined {
  return str(asRecord(payload)["requestId"]);
}

function withOptionalRequestId(
  title: string,
  body: string,
  requestId: string | undefined,
): NotificationDisplay {
  return requestId !== undefined ? { title, body, requestId } : { title, body };
}

export function formatNotificationForDisplay(type: string, payload: unknown): NotificationDisplay {
  const p = asRecord(payload);
  const requestId = str(p.requestId);

  switch (type) {
    case "coverage.swap_requested": {
      const twoWay = bool(p.twoWay);
      return withOptionalRequestId(
        twoWay ? "Shift trade request" : "Shift handoff request",
        twoWay
          ? "A coworker wants to trade shifts with you: you’d take theirs and they’d take yours. Tap Accept if you agree— a manager still has to approve."
          : "A coworker asked you to take their shift (no trade). If you can work it, tap Accept— a manager still has to approve.",
        requestId,
      );
    }
    case "coverage.manager_pending": {
      const kind = str(p.type);
      const twoWay = bool(p.twoWay);
      if (kind === "DROP") {
        return withOptionalRequestId(
          "Staff offered a shift (pickup)",
          "Someone posted a shift they can’t work. Review the schedule and watch for a follow-up when someone offers to cover.",
          requestId,
        );
      }
      return withOptionalRequestId(
        "Swap request pending",
        twoWay
          ? "A two-way swap was requested. When both people have accepted, you’ll get another notice—tap Approve there."
          : "A shift handoff was requested. When the teammate accepts, you’ll get another notice—tap Approve there.",
        requestId,
      );
    }
    case "coverage.accepted":
      return withOptionalRequestId(
        "Coverage request accepted",
        "The other person accepted. If you’re the original requester and changed your mind, you can Withdraw before a manager approves.",
        requestId,
      );
    case "coverage.ready_for_approval":
      return withOptionalRequestId(
        "Ready for your approval",
        "The teammate has accepted. Review and tap Approve to finalize the schedule change.",
        requestId,
      );
    case "coverage.approved": {
      const twoWay = bool(p.twoWay);
      return withOptionalRequestId(
        "Coverage approved",
        twoWay
          ? "A manager approved the swap. Assignments are updated on the schedule."
          : "A manager approved the change. Assignments are updated on the schedule.",
        requestId,
      );
    }
    case "coverage.cancelled": {
      const reason = str(p.reason);
      if (reason === "shift_edited") {
        return withOptionalRequestId(
          "Coverage request cancelled",
          "The shift was edited by a manager, so this coverage or swap request was cancelled. Check the schedule for the latest times.",
          requestId,
        );
      }
      if (reason === "requester") {
        return {
          title: "Coverage request withdrawn",
          body: "The person who requested coverage withdrew the request.",
        };
      }
      return withOptionalRequestId(
        "Coverage request cancelled",
        "This coverage or swap request is no longer active.",
        requestId,
      );
    }
    case "assignment.created":
      return {
        title: "New shift assignment",
        body: "You were assigned to a published shift. Open My schedule to see when and where.",
      };
    case "schedule.unpublished": {
      const msg = str(p.message);
      return {
        title: "Schedule unpublished",
        body: msg ?? "Your site’s schedule week was unpublished. Check with your manager for updates.",
      };
    }
    case "staff.availability_changed":
      return {
        title: "Staff availability updated",
        body: "A team member changed their availability for your location. Review staffing if you’re building the schedule.",
      };
    default: {
      const tail = type.includes(".") ? (type.split(".").pop() ?? type) : type;
      const words = tail.replace(/_/g, " ");
      const title = words.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        title,
        body: "If you’re not sure what this means, ask your manager.",
      };
    }
  }
}

export function formatNotificationTime(iso: string, locale = "en"): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}
