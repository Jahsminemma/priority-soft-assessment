import { Fragment, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createInvite, fetchLocations, fetchSkills, fetchTeam, updateStaffLocations } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { UserRole } from "@shiftsync/shared";

function buildInviteUrl(token: string): string {
  return `${window.location.origin}/register?token=${encodeURIComponent(token)}`;
}

export default function TeamPage(): React.ReactElement {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("STAFF");
  const [desiredHours, setDesiredHours] = useState<number | "">("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [staffInviteLocationIds, setStaffInviteLocationIds] = useState<string[]>([]);
  const [staffSkillIds, setStaffSkillIds] = useState<string[]>([]);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editLocationIds, setEditLocationIds] = useState<string[]>([]);
  const [locationEditError, setLocationEditError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [lastInvite, setLastInvite] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);

  const queryClient = useQueryClient();
  const teamQuery = useQuery({
    queryKey: ["admin", "team", token],
    queryFn: () => fetchTeam(token!),
    enabled: Boolean(isAdmin && token),
  });

  const patchLocationsMutation = useMutation({
    mutationFn: async ({ staffUserId, locationIds }: { staffUserId: string; locationIds: string[] }) => {
      await updateStaffLocations(token!, staffUserId, { locationIds });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "team", token] });
      setEditingStaffId(null);
      setLocationEditError(null);
    },
    onError: (err: Error) => {
      setLocationEditError(err.message);
    },
  });

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(isAdmin && token),
  });

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    queryFn: () => fetchSkills(token!),
    enabled: Boolean(isAdmin && token),
  });

  const expiresLabel = useMemo(() => {
    if (!lastInvite) return "";
    return new Date(lastInvite.expiresAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }, [lastInvite]);

  function toggleLocation(id: string): void {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleStaffSkill(id: string): void {
    setStaffSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleStaffInviteLocation(id: string): void {
    setStaffInviteLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleEditLocation(id: string): void {
    setEditLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function beginEditLocations(staffId: string, currentLocationIds: string[]): void {
    setLocationEditError(null);
    setEditingStaffId(staffId);
    setEditLocationIds([...currentLocationIds]);
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setPending(true);
    setLastInvite(null);
    setCopyState("idle");
    try {
      const res = await createInvite(token, {
        email,
        name,
        role,
        ...(role === "STAFF"
          ? {
              desiredHoursWeekly: desiredHours === "" ? null : Number(desiredHours),
              staffSkillIds,
              staffLocationIds: staffInviteLocationIds,
            }
          : {}),
        ...(role === "MANAGER" ? { managerLocationIds: locationIds } : {}),
      });
      const url = buildInviteUrl(res.token);
      setLastInvite({ url, expiresAt: res.expiresAt });
      void teamQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.url);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setError("Could not copy—select the link and copy it manually.");
    }
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page__title">Team</h1>
        <div className="card">
          <p className="muted">Only administrators can view team and create invites.</p>
        </div>
      </div>
    );
  }

  const team = teamQuery.data;

  return (
    <div className="page">
      <h1 className="page__title">Team</h1>
      <p className="page__lead muted">
        Managers and staff who already have accounts. Invite someone new with a one-time registration link below.
      </p>

      <div className="card stack">
        <h2 className="card__title">Managers</h2>
        {teamQuery.isLoading ? (
          <p className="muted">Loading…</p>
        ) : teamQuery.isError ? (
          <p className="text-error">{teamQuery.error instanceof Error ? teamQuery.error.message : "Could not load team."}</p>
        ) : team && team.managers.length === 0 ? (
          <p className="muted">No managers yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Locations</th>
                <th>Skills</th>
              </tr>
            </thead>
            <tbody>
              {team!.managers.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="mono">{m.email}</td>
                  <td>
                    {m.locations.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      m.locations.map((l) => l.name).join(", ")
                    )}
                  </td>
                  <td className="muted">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <h2 className="card__title">Staff</h2>
        {teamQuery.isLoading ? (
          <p className="muted">Loading…</p>
        ) : teamQuery.isError ? null : team && team.staff.length === 0 ? (
          <p className="muted">No staff yet.</p>
        ) : team ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Locations</th>
                <th>Skills</th>
                <th>Desired hrs / week</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {team.staff.map((s) => (
                <Fragment key={s.id}>
                  <tr>
                    <td>{s.name}</td>
                    <td className="mono">{s.email}</td>
                    <td>
                      {s.locations.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        s.locations.map((l) => l.name).join(", ")
                      )}
                    </td>
                    <td>
                      {s.skills.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        s.skills.map((sk) => sk.name).join(", ")
                      )}
                    </td>
                    <td>{s.desiredHoursWeekly == null ? "—" : String(s.desiredHoursWeekly)}</td>
                    <td>
                      {editingStaffId === s.id ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => {
                            setEditingStaffId(null);
                            setLocationEditError(null);
                          }}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => beginEditLocations(s.id, s.locations.map((l) => l.id))}
                        >
                          Edit locations
                        </button>
                      )}
                    </td>
                  </tr>
                  {editingStaffId === s.id ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="stack">
                          <p className="field__label">Certified locations</p>
                          <p className="field-hint">Staff can only be assigned to shifts at these sites.</p>
                          <div className="checkbox-list">
                            {(locationsQuery.data ?? []).map((l) => (
                              <label key={l.id} className="checkbox-list__item">
                                <input
                                  type="checkbox"
                                  checked={editLocationIds.includes(l.id)}
                                  onChange={() => toggleEditLocation(l.id)}
                                />
                                <span>{l.name}</span>
                              </label>
                            ))}
                          </div>
                          {locationEditError ? <p className="text-error">{locationEditError}</p> : null}
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn btn--primary"
                              disabled={patchLocationsMutation.isPending || editLocationIds.length === 0}
                              onClick={() => {
                                setLocationEditError(null);
                                patchLocationsMutation.mutate({ staffUserId: s.id, locationIds: editLocationIds });
                              }}
                            >
                              {patchLocationsMutation.isPending ? "Saving…" : "Save locations"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="card stack">
        <h2 className="card__title">Invite someone</h2>
        <p className="muted small">
          Create an account for a new manager or staff member. We’ll give you a one-time link so they can choose their
          password.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="stack">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label className="field">
            <span className="field__label">Role</span>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole);
                setLocationIds([]);
                setStaffSkillIds([]);
                setStaffInviteLocationIds([]);
              }}
            >
              <option value="STAFF">Staff</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          {role === "STAFF" ? (
            <>
              <fieldset className="field">
                <legend className="field__label">Skills</legend>
                <p className="field-hint">At least one. These match shift requirements (server, bartender, etc.).</p>
                <div className="checkbox-list">
                  {(skillsQuery.data ?? []).map((sk) => (
                    <label key={sk.id} className="checkbox-list__item">
                      <input
                        type="checkbox"
                        checked={staffSkillIds.includes(sk.id)}
                        onChange={() => toggleStaffSkill(sk.id)}
                      />
                      <span>{sk.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field">
                <legend className="field__label">Locations</legend>
                <p className="field-hint">At least one. They can only work shifts at sites where they are certified.</p>
                <div className="checkbox-list">
                  {(locationsQuery.data ?? []).map((l) => (
                    <label key={l.id} className="checkbox-list__item">
                      <input
                        type="checkbox"
                        checked={staffInviteLocationIds.includes(l.id)}
                        onChange={() => toggleStaffInviteLocation(l.id)}
                      />
                      <span>{l.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span className="field__label">Desired hours per week (optional)</span>
                <input
                  type="number"
                  min={0}
                  max={80}
                  step={1}
                  value={desiredHours}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDesiredHours(v === "" ? "" : Number(v));
                  }}
                />
              </label>
            </>
          ) : null}
          {role === "MANAGER" ? (
            <fieldset className="field">
              <legend className="field__label">Locations they manage</legend>
              <p className="field-hint">Select at least one site this manager can run.</p>
              <div className="checkbox-list">
                {(locationsQuery.data ?? []).map((l) => (
                  <label key={l.id} className="checkbox-list__item">
                    <input
                      type="checkbox"
                      checked={locationIds.includes(l.id)}
                      onChange={() => toggleLocation(l.id)}
                    />
                    <span>{l.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {error ? <p className="text-error">{error}</p> : null}
          <button
            type="submit"
            className="btn btn--primary"
            disabled={
              pending ||
              (role === "STAFF" && (staffSkillIds.length === 0 || staffInviteLocationIds.length === 0))
            }
          >
            {pending ? "Creating…" : "Create invite link"}
          </button>
        </form>
      </div>

      {lastInvite ? (
        <div className="card stack invite-result">
          <h2 className="card__title">Share this link</h2>
          <p className="muted small">Expires {expiresLabel}</p>
          <div className="copy-row">
            <input readOnly className="copy-row__input mono" value={lastInvite.url} aria-label="Registration link" />
            <button type="button" className="btn btn--secondary" onClick={() => void copyLink()}>
              {copyState === "copied" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
