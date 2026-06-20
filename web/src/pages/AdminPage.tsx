import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError, apiCreateUser, apiDeleteUser, apiGetUsers, apiUpdateUser } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { AdminUser } from "../types.js";

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp));
  } catch {
    return "Unknown";
  }
}

export default function AdminPage() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <AdminDashboard currentUserId={user.id} />;
}

function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    try {
      const us = await apiGetUsers();
      setUsers(us);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load users.");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function showSuccess(msg: string) {
    setActionSuccess(msg);
    setActionError(null);
    setTimeout(() => setActionSuccess(null), 3000);
  }

  function showError(err: unknown) {
    setActionError(err instanceof ApiError ? err.message : "Action failed.");
    setActionSuccess(null);
  }

  async function handleToggleEnabled(u: AdminUser) {
    try {
      await apiUpdateUser(u.id, { enabled: !u.enabled });
      showSuccess(`${u.username} ${u.enabled ? "disabled" : "enabled"}.`);
      await reload();
    } catch (err) {
      showError(err);
    }
  }

  async function handleRoleChange(u: AdminUser, role: "admin" | "user") {
    try {
      await apiUpdateUser(u.id, { role });
      showSuccess(`${u.username} role changed to ${role}.`);
      await reload();
    } catch (err) {
      showError(err);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await apiDeleteUser(deleteTarget.id);
      showSuccess(`${deleteTarget.username} deleted.`);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      showError(err);
      setDeleteTarget(null);
    }
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.length < 12) {
      setResetError("Password must be at least 12 characters.");
      return;
    }
    try {
      await apiUpdateUser(resetTarget.id, { password: resetPassword });
      if (resetTarget.id === currentUserId) {
        window.location.assign("/login");
        return;
      }
      showSuccess(`Password updated for ${resetTarget.username}.`);
      setResetTarget(null);
      setResetPassword("");
      setResetError(null);
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : "Failed to reset password.");
    }
  }

  const isProtected = (u: AdminUser) => u.isPrimary || u.id === currentUserId;

  if (loadError) {
    return (
      <main className="min-h-screen bg-ivory px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-heading text-3xl text-espresso mb-6">Admin Dashboard</h1>
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-700"
          >
            {loadError}
          </div>
        </div>
      </main>
    );
  }

  if (users === null) {
    return (
      <main className="min-h-screen bg-ivory flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading users"
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ivory px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="font-heading text-3xl text-espresso">Admin Dashboard</h1>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const me = users.find((u) => u.id === currentUserId);
                if (me) setResetTarget(me);
                setResetPassword("");
                setResetError(null);
              }}
              className="font-body text-xs font-semibold uppercase tracking-widest px-4 min-h-touch
                         border border-espresso text-espresso rounded-card hover:bg-espresso/5
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
            >
              Change my password
            </button>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="font-body text-xs font-semibold uppercase tracking-widest px-4 min-h-touch
                       bg-espresso text-ivory rounded-card hover:opacity-90 transition-opacity
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
            >
              {showCreate ? "Cancel" : "Create User"}
            </button>
          </div>
        </div>

        {actionSuccess && (
          <output
            aria-live="polite"
            className="block bg-green-50 border border-green-200 rounded-card p-3 text-sm text-green-800"
          >
            {actionSuccess}
          </output>
        )}
        {actionError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-card p-3 text-sm text-red-700"
          >
            {actionError}
          </div>
        )}

        {showCreate && (
          <CreateUserForm
            onCreated={async () => {
              showSuccess("User created.");
              setShowCreate(false);
              await reload();
            }}
            onError={showError}
          />
        )}

        <section aria-label="Users">
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded-card border border-espresso/5 text-sm font-body">
              <thead>
                <tr className="border-b border-espresso/10 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Username
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Created
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Recipes
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Role
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-sage">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const protected_ = isProtected(u);
                  return (
                    <tr key={u.id} className="border-b border-espresso/5 last:border-0">
                      <td className="px-4 py-3 text-espresso font-semibold">
                        {u.username}
                        {u.isPrimary && (
                          <span className="ml-2 text-xs text-sage font-normal">
                            (primary admin)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-espresso/60">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-3 text-espresso/60">{u.recipeCount}</td>
                      <td className="px-4 py-3">
                        {protected_ ? (
                          <span className="text-espresso/60 capitalize">{u.role}</span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              handleRoleChange(u, e.target.value as "admin" | "user")
                            }
                            aria-label={`Role for ${u.username}`}
                            className="text-sm border border-espresso/20 rounded px-2 py-1
                                       text-espresso bg-white focus:outline-none focus:ring-2
                                       focus:ring-terracotta"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {protected_ ? (
                          <span className="text-espresso/60">
                            {u.enabled ? "Enabled" : "Disabled"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(u)}
                            aria-label={`${u.enabled ? "Disable" : "Enable"} ${u.username}`}
                            className={`text-xs font-semibold px-3 py-1 rounded-full
                                        focus-visible:outline-2 focus-visible:outline-offset-2
                                        focus-visible:outline-terracotta
                                        ${
                                          u.enabled
                                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                                            : "bg-red-100 text-red-800 hover:bg-red-200"
                                        }`}
                          >
                            {u.enabled ? "Enabled" : "Disabled"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(u);
                              setResetPassword("");
                              setResetError(null);
                            }}
                            aria-label={`Reset password for ${u.username}`}
                            className="text-xs underline text-espresso/60 hover:text-espresso
                                       focus-visible:outline-2"
                          >
                            Reset pw
                          </button>
                          {!protected_ && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(u)}
                              aria-label={`Delete ${u.username}`}
                              className="text-xs underline text-red-600 hover:text-red-800
                                         focus-visible:outline-2"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <dialog
          open
          aria-labelledby="delete-title"
          className="fixed inset-0 m-0 w-full h-full bg-espresso/50 flex items-center justify-center p-4 z-50 border-0"
        >
          <div className="bg-ivory rounded-card p-6 max-w-sm w-full space-y-4">
            <h2 id="delete-title" className="font-heading text-xl text-espresso">
              Delete user?
            </h2>
            <p className="text-sm text-espresso/80">
              Deleting <strong>{deleteTarget.username}</strong> will permanently delete this account
              and all their recipe history. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 min-h-touch bg-red-600 text-white font-semibold rounded-card
                           hover:bg-red-700 transition-colors focus-visible:outline-2"
              >
                Delete permanently
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 min-h-touch border border-espresso/20 text-espresso font-semibold
                           rounded-card hover:bg-espresso/5 transition-colors focus-visible:outline-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <dialog
          open
          aria-labelledby="reset-title"
          className="fixed inset-0 m-0 w-full h-full bg-espresso/50 flex items-center justify-center p-4 z-50 border-0"
        >
          <div className="bg-ivory rounded-card p-6 max-w-sm w-full space-y-4">
            <h2 id="reset-title" className="font-heading text-xl text-espresso">
              {resetTarget.id === currentUserId ? "Change my password" : "Reset password"}
            </h2>
            <p className="text-sm text-espresso/60">
              New password for <strong>{resetTarget.username}</strong>
            </p>
            {resetTarget.id === currentUserId && (
              <p className="text-xs text-sage">You will be signed out after changing it.</p>
            )}
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (min 12 chars)"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              aria-label="New password"
              aria-describedby={resetError ? "reset-error" : undefined}
              className="w-full min-h-touch px-4 rounded-card border border-espresso/20 bg-white
                         font-body text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta"
            />
            {resetError && (
              <p id="reset-error" role="alert" className="text-xs text-red-600">
                {resetError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleResetPassword}
                className="flex-1 min-h-touch bg-espresso text-ivory font-semibold rounded-card
                           hover:opacity-90 transition-opacity focus-visible:outline-2"
              >
                Update password
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError(null);
                }}
                className="flex-1 min-h-touch border border-espresso/20 text-espresso font-semibold
                           rounded-card hover:bg-espresso/5 transition-colors focus-visible:outline-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}
    </main>
  );
}

interface CreateUserFormProps {
  onCreated: () => void;
  onError: (err: unknown) => void;
}

function CreateUserForm({ onCreated, onError }: CreateUserFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: { username?: string; password?: string } = {};
    if (username.trim().length < 3) errs.username = "Must be at least 3 characters.";
    if (password.length < 12) errs.password = "Must be at least 12 characters.";
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await apiCreateUser(username.trim(), password, role);
      setUsername("");
      setPassword("");
      setRole("user");
      onCreated();
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-card p-4 space-y-4"
      aria-label="Create new user"
    >
      <h2 className="font-heading text-lg text-espresso">Create User</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label
            htmlFor="new-username"
            className="block text-xs font-semibold uppercase tracking-widest text-sage"
          >
            Username
          </label>
          <input
            id="new-username"
            type="text"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            aria-describedby={fieldErrors.username ? "new-username-error" : undefined}
            className={`w-full min-h-touch px-3 rounded-[12px] border bg-ivory font-body text-sm
                        text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta
                        ${fieldErrors.username ? "border-red-400" : "border-espresso/20"}`}
          />
          {fieldErrors.username && (
            <p id="new-username-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.username}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label
            htmlFor="new-password"
            className="block text-xs font-semibold uppercase tracking-widest text-sage"
          >
            Password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            aria-describedby={fieldErrors.password ? "new-password-error" : undefined}
            className={`w-full min-h-touch px-3 rounded-[12px] border bg-ivory font-body text-sm
                        text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta
                        ${fieldErrors.password ? "border-red-400" : "border-espresso/20"}`}
          />
          {fieldErrors.password && (
            <p id="new-password-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label
            htmlFor="new-role"
            className="block text-xs font-semibold uppercase tracking-widest text-sage"
          >
            Role
          </label>
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "user")}
            disabled={submitting}
            className="w-full min-h-touch px-3 rounded-[12px] border border-espresso/20 bg-ivory
                       font-body text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="min-h-touch px-6 bg-espresso text-ivory font-body font-semibold rounded-card
                   hover:opacity-90 transition-opacity disabled:opacity-40 focus-visible:outline-2"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
