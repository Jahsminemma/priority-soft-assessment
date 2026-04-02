import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { completeRegister, verifyRegisterToken } from "../api.js";

export default function RegisterPage(): React.ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [verifyLoading, setVerifyLoading] = useState(Boolean(token));
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleLabel, setRoleLabel] = useState("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerifyLoading(false);
      return;
    }
    let cancelled = false;
    setVerifyLoading(true);
    setVerifyError(null);
    void verifyRegisterToken(token)
      .then((v) => {
        if (cancelled) return;
        setName(v.name);
        setEmail(v.email);
        setRoleLabel(v.role === "STAFF" ? "Staff" : v.role === "MANAGER" ? "Manager" : "Administrator");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVerifyError(err instanceof Error ? err.message : "This link isn’t valid.");
      })
      .finally(() => {
        if (!cancelled) setVerifyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    if (password.length < 8) {
      setSubmitError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== password2) {
      setSubmitError("Passwords don’t match.");
      return;
    }
    setPending(true);
    try {
      await completeRegister(token, password);
      navigate("/login", { replace: true, state: { registeredEmail: email } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not complete registration.");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card card">
          <p className="login-kicker">ShiftSync</p>
          <h1 className="login-title">Registration link</h1>
          <p className="muted">
            Open the registration link your administrator sent you. If you only have the address of this app, ask them to
            create an invite for you first.
          </p>
          <p>
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  if (verifyLoading) {
    return (
      <div className="login-page">
        <div className="login-card card">
          <p className="muted">Checking your invite…</p>
        </div>
      </div>
    );
  }

  if (verifyError) {
    return (
      <div className="login-page">
        <div className="login-card card">
          <p className="login-kicker">ShiftSync</p>
          <h1 className="login-title">Invite unavailable</h1>
          <p className="text-error">{verifyError}</p>
          <p className="muted">Ask your administrator for a new invite if you still need access.</p>
          <p>
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <p className="login-kicker">ShiftSync</p>
        <h1 className="login-title">Finish sign-up</h1>
        <p className="muted">
          You’re joining as <strong>{name}</strong> ({email}) — <strong>{roleLabel}</strong>.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="stack">
          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <span className="field-hint">At least 8 characters.</span>
          </label>
          <label className="field">
            <span className="field__label">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {submitError ? <p className="text-error">{submitError}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={pending}>
            {pending ? "Saving…" : "Create account"}
          </button>
        </form>
        <p className="muted small">
          <Link to="/login">Already have an account? Sign in</Link>
        </p>
      </div>
    </div>
  );
}
