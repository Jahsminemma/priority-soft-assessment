import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

export default function LoginPage(): React.ReactElement {
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const registeredEmail = (location.state as { registeredEmail?: string } | undefined)?.registeredEmail;
  const [email, setEmail] = useState("manager@coastaleats.test");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (registeredEmail) setEmail(registeredEmail);
  }, [registeredEmail]);

  if (token) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch {
      setError("We couldn’t sign you in. Check your email and password, then try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <p className="login-kicker">ShiftSync</p>
        <h1 className="login-title">Sign in</h1>
        <p className="muted">Enter your work email and password. If you’re trying the demo, use the accounts your team shared with you.</p>
        {registeredEmail ? (
          <p className="login-banner-ok">You’re set up. Sign in with the password you just chose.</p>
        ) : null}
        <form onSubmit={(e) => void onSubmit(e)} className="stack">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              type="email"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="text-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted small">
          <Link to="/register">I have a registration link from my administrator</Link>
        </p>
      </div>
    </div>
  );
}
