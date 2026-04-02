import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotificationPrefs, patchNotificationPrefs } from "../api.js";
import { FeedbackModal, messageFromError } from "../components/FeedbackModal.js";
import { useAuth } from "../context/AuthContext.js";

type FeedbackState = { variant: "success" | "error"; title: string; message: string } | null;

export default function SettingsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [inApp, setInApp] = useState(true);
  const [emailSim, setEmailSim] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const prefsQuery = useQuery({
    queryKey: ["notificationPrefs", token],
    queryFn: () => getNotificationPrefs(token!),
    enabled: Boolean(token),
  });

  useEffect(() => {
    const p = prefsQuery.data;
    if (!p) return;
    if (p.inApp !== undefined) setInApp(p.inApp);
    if (p.emailSimulated !== undefined) setEmailSim(p.emailSimulated);
  }, [prefsQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => patchNotificationPrefs(token!, { inApp, emailSimulated: emailSim }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notificationPrefs"] });
      setFeedback({
        variant: "success",
        title: "Saved",
        message: "Your notification preferences were updated.",
      });
    },
    onError: (err) => {
      setFeedback({
        variant: "error",
        title: "Couldn’t save settings",
        message: messageFromError(err, "Try again in a moment."),
      });
    },
  });

  useEffect(() => {
    if (prefsQuery.isError) {
      setFeedback({
        variant: "error",
        title: "Couldn’t load settings",
        message: "Refresh the page or try again later.",
      });
    }
  }, [prefsQuery.isError]);

  useEffect(() => {
    if (prefsQuery.data && feedback?.title === "Couldn’t load settings") {
      setFeedback(null);
    }
  }, [prefsQuery.data, feedback]);

  return (
    <div className="page">
      <h1 className="page__title">Settings</h1>
      <p className="page__lead muted">
        Choose how you want to be notified. In-app messages always appear in your notification list. Email (demo) is for
        teams that will add real email later—in this demo it only records your choice.
      </p>

      <div className="card stack">
        <h2 className="card__title">Notifications</h2>
        {prefsQuery.isLoading ? <p className="muted">Loading…</p> : null}
        <label className="field field--checkbox">
          <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
          <span>Show alerts in the app</span>
        </label>
        <label className="field field--checkbox">
          <input type="checkbox" checked={emailSim} onChange={(e) => setEmailSim(e.target.checked)} />
          <span>Email (no real email sending capability yet)</span>
        </label>
        <button type="button" className="btn btn--primary" disabled={saveMut.isPending} onClick={() => void saveMut.mutateAsync()}>
          {saveMut.isPending ? "Saving…" : "Save changes"}
        </button>
        {prefsQuery.isError && !feedback ? (
          <p className="text-error">We couldn’t load your settings. Refresh the page.</p>
        ) : null}
      </div>

      {user?.role === "STAFF" ? (
        <div className="card stack">
          <h2 className="card__title">Availability</h2>
          <p className="muted">
            Set your weekly hours and one-off exceptions on{" "}
            <Link to="/availability">My availability</Link>.
          </p>
        </div>
      ) : null}

      <FeedbackModal
        open={feedback !== null}
        variant={feedback?.variant ?? "success"}
        title={feedback?.title ?? ""}
        message={feedback?.message ?? ""}
        onClose={() => setFeedback(null)}
      />
    </div>
  );
}
