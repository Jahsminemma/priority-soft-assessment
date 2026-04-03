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

  const shiftLine = (v: unknown): string | null => {
    const r = asRecord(v);
    const loc = str(r.locationName);
    const skill = str(r.skillName);
    const date = str(r.localDateLabel);
    const time = str(r.localTimeLabel);
    if (!loc || !date || !time) return null;
    const tail = `${loc}${skill ? ` · ${skill}` : ""} · ${date} · ${time}`;
    return tail;
  };

  switch (type) {
    case "coverage.swap_requested": {
      const twoWay = bool(p.twoWay);
      const requesterName = str(p.requesterName) ?? "Coworker";
      const take = shiftLine(p.theirShift);
      const give = shiftLine(p.myShift);
      return withOptionalRequestId(
        twoWay ? "Shift trade request" : "Shift handoff request",
        twoWay
          ? `${requesterName} wants to trade shifts.\n\nYou’d take: ${take ?? "their shift"}\nYou’d give: ${give ?? "your shift"}\n\nTap Accept to agree (a manager still has to approve), or Reject to decline.`
          : "A coworker asked you to take their shift (no trade). If you can work it, tap Accept— a manager still has to approve.",
        requestId,
      );
    }
    case "coverage.callout_open": {
      const requesterName = str(p.requesterName) ?? "A coworker";
      const take = shiftLine(p.theirShift);
      return withOptionalRequestId(
        "Open shift — volunteer",
        `${requesterName} needs coverage. If you claim, a manager must approve before you’re assigned (schedule rules apply).\n\n${take ?? "Shift"}\n\nOnly one person can be pending at a time for this offer.`,
        requestId,
      );
    }
    case "coverage.manager_pending": {
      const kind = str(p.type);
      const twoWay = bool(p.twoWay);
      if (kind === "DROP") {
        return withOptionalRequestId(
          "Staff offered a shift (pickup)",
          "Someone posted a shift they can’t work. Eligible staff may claim it; you approve before the assignment moves.",
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

    case "coverage.declined":
      return withOptionalRequestId(
        "Swap request declined",
        "The teammate declined your swap request. You can pick another person to trade with, or offer your shift for pickup.",
        requestId,
      );

    case "coverage.ready_for_approval":
      return withOptionalRequestId(
        "Ready for your approval",
        "A teammate accepted a swap or claimed an open shift. Review and tap Approve to finalize (rules are checked again at approval).",
        requestId,
      );

    case "coverage.drop_claim_pending":
      return withOptionalRequestId(
        "Claim recorded — manager approval needed",
        "You volunteered for an open shift. You are not assigned yet. A manager must approve before it appears on your schedule.",
        requestId,
      );
      
    case "coverage.shift_assigned": {
      const swap = bool(p.swap);
      const fromDrop = bool(p.fromDrop);
      const line = shiftLine(p);
      if (swap) {
        return withOptionalRequestId(
          "You were assigned a shift (swap)",
          `A manager approved the swap. You’re now scheduled for:\n\n${line ?? "Open My schedule for details."}\n\nCheck My schedule for the full week.`,
          requestId,
        );
      }
      if (fromDrop) {
        return withOptionalRequestId(
          "You were assigned a dropped shift",
          `A teammate offered this shift for pickup and you’re now on the schedule for it:\n\n${line ?? "Open My schedule for details."}\n\nOpen My schedule to confirm date and time.`,
          requestId,
        );
      }
      return withOptionalRequestId(
        "You were assigned a shift",
        `You’re now on the schedule for this shift:\n\n${line ?? "Open My schedule for details."}\n\nOpen My schedule to confirm date and time.`,
        requestId,
      );
    }
    case "coverage.drop_resolved":
      return withOptionalRequestId(
        "Your shift offer is complete",
        "You’re no longer assigned to that slot. Another teammate is now on the schedule for that shift (or the offer was resolved). Open My schedule if you want to double-check.",
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
      const locationName = str(p.locationName);
      const weekKey = str(p.weekKey);
      const where = locationName ? ` for ${locationName}` : "";
      const when = weekKey ? ` (${weekKey})` : "";
      return {
        title: "Schedule unpublished",
        body:
          msg ??
          `A schedule week${where} was unpublished${when}. Shifts may change — check with your manager for updates.`,
      };
    }
    case "schedule.published": {
      const locationName = str(p.locationName);
      const weekKey = str(p.weekKey);
      const kind = str(p.kind);
      const isUpdate = kind === "updated";
      const title = isUpdate ? "Schedule updated" : "Schedule published";
      const where = locationName ? ` for ${locationName}` : "";
      const when = weekKey ? ` (${weekKey})` : "";
      return {
        title,
        body: `A new schedule week${where} was ${isUpdate ? "updated" : "published"}${when}. Open My schedule to see your shifts.`,
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
