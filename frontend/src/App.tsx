import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { commitAssignment, login, previewAssignment } from "./api.js";

const DEMO_SHIFT = "d0000000-0000-4000-8000-000000000001";
const DEMO_STAFF = "c0000000-0000-4000-8000-000000000010";

export default function App(): React.ReactElement {
  const [email, setEmail] = useState("manager@coastaleats.test");
  const [password, setPassword] = useState("password123");
  const [token, setToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem("token") : null,
  );
  const [preview, setPreview] = useState<unknown>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const t = await login(email, password);
      localStorage.setItem("token", t);
      setToken(t);
      return t;
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not logged in");
      return previewAssignment(token, DEMO_SHIFT, DEMO_STAFF);
    },
    onSuccess: (data) => setPreview(data),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not logged in");
      return commitAssignment(token, {
        shiftId: DEMO_SHIFT,
        staffUserId: DEMO_STAFF,
        idempotencyKey,
      });
    },
  });

  return (
    <div className="app">
      <h1>ShiftSync</h1>
      <p style={{ color: "#475569" }}>Coastal Eats — scheduling</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <div className="row">
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>
        <button type="button" onClick={() => void loginMutation.mutateAsync()}>
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </button>
        {loginMutation.isError ? (
          <p style={{ color: "#b91c1c" }}>Login failed (check API + seed).</p>
        ) : null}
        {token ? <p style={{ color: "#15803d" }}>Session active.</p> : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Assignment preview (demo)</h2>
        <p style={{ marginTop: 0, color: "#475569", fontSize: 14 }}>
          Shift <code>{DEMO_SHIFT}</code> → Staff <code>{DEMO_STAFF}</code>
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={!token} onClick={() => void previewMutation.mutateAsync()}>
            Preview constraints
          </button>
          <button type="button" disabled={!token} onClick={() => void commitMutation.mutateAsync()}>
            Commit assignment
          </button>
        </div>
        {previewMutation.isError || commitMutation.isError ? (
          <p style={{ color: "#b91c1c" }}>Request failed.</p>
        ) : null}
        {preview ? (
          <pre style={{ overflow: "auto", fontSize: 12 }}>{JSON.stringify(preview, null, 2)}</pre>
        ) : null}
        {commitMutation.data ? (
          <pre style={{ overflow: "auto", fontSize: 12 }}>
            {JSON.stringify(commitMutation.data, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
