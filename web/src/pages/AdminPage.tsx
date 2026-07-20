import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, apiCreateUser, apiDeleteUser, apiGetUsers, apiUpdateUser } from "../api.js";
import StudioIcon from "../components/StudioIcon.js";
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

function useModalDialog(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    function handleCancel(event: Event) {
      event.preventDefault();
      onCloseRef.current();
    }

    document.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("cancel", handleCancel);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("cancel", handleCancel);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      document.body.style.overflow = previousOverflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [isOpen]);

  return dialogRef;
}

export default function AdminPage() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <AdminDashboard currentUserId={user.id} />;
}

function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const deleteDialogRef = useModalDialog(deleteTarget !== null, () => setDeleteTarget(null));
  const resetDialogRef = useModalDialog(resetTarget !== null, () => {
    setResetTarget(null);
    setResetPassword("");
    setResetError(null);
  });

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      setUsers(await apiGetUsers());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load users.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function showSuccess(message: string) {
    setActionSuccess(message);
    setActionError(null);
  }

  function showError(err: unknown) {
    setActionError(err instanceof ApiError ? err.message : "Action failed.");
    setActionSuccess(null);
  }

  function openPasswordDialog(target: AdminUser) {
    setResetTarget(target);
    setResetPassword("");
    setResetError(null);
  }

  async function handleToggleEnabled(target: AdminUser) {
    try {
      await apiUpdateUser(target.id, { enabled: !target.enabled });
      showSuccess(`${target.username} ${target.enabled ? "disabled" : "enabled"}.`);
      await reload();
    } catch (err) {
      showError(err);
    }
  }

  async function handleRoleChange(target: AdminUser, role: "admin" | "user") {
    try {
      await apiUpdateUser(target.id, { role });
      showSuccess(`${target.username} role changed to ${role}.`);
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
    if (resetPassword.length < 4) {
      setResetError("Password must be at least 4 characters.");
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

  const isProtected = (target: AdminUser) => target.isPrimary || target.id === currentUserId;

  if (loadError) {
    return (
      <main className="collection-page admin-page">
        <header className="page-heading">
          <div>
            <p className="section-kicker">Account control</p>
            <h1>Admin Dashboard</h1>
            <p>Manage access and review recipe activity.</p>
          </div>
        </header>
        <div role="alert" className="content-section bg-red-50 border-red-200 text-red-700">
          {loadError}
        </div>
      </main>
    );
  }

  if (users === null) {
    return (
      <main className="collection-page flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading users"
        />
      </main>
    );
  }

  const currentUser = users.find((item) => item.id === currentUserId);
  const activeUsers = users.filter((item) => item.enabled).length;
  const totalRecipes = users.reduce((total, item) => total + item.recipeCount, 0);

  return (
    <main className="collection-page admin-page">
      <header className="page-heading admin-heading">
        <div>
          <p className="section-kicker">Account control</p>
          <h1>Admin Dashboard</h1>
          <p>Manage access and review recipe activity.</p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={!currentUser}
            onClick={() => currentUser && openPasswordDialog(currentUser)}
          >
            Change my password
          </button>
          <button
            type="button"
            className="primary-small"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Cancel" : "Create User"}
          </button>
        </div>
      </header>

      {actionSuccess ? (
        <output className="demo-notice" aria-live="polite">
          {actionSuccess}
          <button type="button" aria-label="Dismiss message" onClick={() => setActionSuccess(null)}>
            ×
          </button>
        </output>
      ) : null}

      {actionError ? (
        <div role="alert" className="demo-notice text-red-700 border-red-200 bg-red-50">
          {actionError}
          <button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}>
            ×
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <CreateUserForm
          onCreated={async () => {
            showSuccess("User created.");
            setShowCreate(false);
            await reload();
          }}
          onError={showError}
        />
      ) : null}

      <section className="admin-summary" aria-label="Account summary">
        <div>
          <small>Total users</small>
          <strong>{users.length}</strong>
        </div>
        <div>
          <small>Active</small>
          <strong>{activeUsers}</strong>
        </div>
        <div>
          <small>Total recipes</small>
          <strong>{totalRecipes}</strong>
        </div>
      </section>

      <section className="user-card-grid" aria-label="Users">
        {users.map((target) => {
          const protectedAccount = isProtected(target);
          return (
            <article className="user-card" key={target.id}>
              <div className="user-card-top">
                <span className="user-avatar">
                  <StudioIcon name="user" />
                </span>
                <div>
                  <h2>{target.username}</h2>
                  <p>{target.isPrimary ? "Primary administrator" : "Bean to Bloom user"}</p>
                </div>
                <span className={`status-pill ${target.enabled ? "enabled" : "disabled"}`}>
                  {target.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              <dl>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(target.createdAt)}</dd>
                </div>
                <div>
                  <dt>Recipes</dt>
                  <dd>
                    <button
                      type="button"
                      aria-label={`View ${target.recipeCount} recipes for ${target.username}`}
                      onClick={() =>
                        navigate(`/admin/users/${encodeURIComponent(target.id)}/recipes`)
                      }
                    >
                      {target.recipeCount}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>
                    {protectedAccount ? (
                      target.role
                    ) : (
                      <select
                        value={target.role}
                        onChange={(event) =>
                          void handleRoleChange(target, event.target.value as "admin" | "user")
                        }
                        aria-label={`Role for ${target.username}`}
                        className="max-w-full rounded-lg border border-espresso/20 bg-transparent px-1 py-0.5"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="user-card-actions">
                <button type="button" onClick={() => openPasswordDialog(target)}>
                  Password
                </button>
                <button
                  type="button"
                  disabled={protectedAccount}
                  aria-label={`${target.enabled ? "Disable" : "Enable"} ${target.username}`}
                  onClick={() => void handleToggleEnabled(target)}
                >
                  {target.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  disabled={protectedAccount}
                  aria-label={`Delete ${target.username}`}
                  onClick={() => setDeleteTarget(target)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {deleteTarget ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteTarget(null);
          }}
        >
          <dialog
            ref={deleteDialogRef}
            className="confirmation-dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              ) {
                setDeleteTarget(null);
              }
            }}
          >
            <div className="dialog-handle" aria-hidden="true" />
            <div className="dialog-heading">
              <div>
                <p className="section-kicker">Permanent action</p>
                <h2 id="delete-title">Delete user?</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close delete confirmation"
                onClick={() => setDeleteTarget(null)}
              >
                <StudioIcon name="close" />
              </button>
            </div>
            <div className="dialog-content">
              <p>
                Deleting <strong>{deleteTarget.username}</strong> will permanently delete this
                account and all their recipe history. This cannot be undone.
              </p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="primary-action" onClick={() => void handleDelete()}>
                Delete permanently <StudioIcon name="arrow" />
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
            </div>
          </dialog>
        </div>
      ) : null}

      {resetTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <dialog
            ref={resetDialogRef}
            className="confirmation-dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <div className="dialog-handle" aria-hidden="true" />
            <div className="dialog-heading">
              <div>
                <p className="section-kicker">Account security</p>
                <h2 id="reset-title">
                  {resetTarget.id === currentUserId ? "Change my password" : "Reset password"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close password dialog"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError(null);
                }}
              >
                <StudioIcon name="close" />
              </button>
            </div>
            <div className="dialog-content">
              <div className="field-grid">
                <label>
                  New password for {resetTarget.username}
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Password (min 4 characters)"
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    aria-label="New password"
                    aria-describedby={resetError ? "reset-error" : undefined}
                  />
                </label>
                {resetTarget.id === currentUserId ? (
                  <p className="text-xs text-sage">
                    You will be signed out after changing your password.
                  </p>
                ) : null}
                {resetError ? (
                  <p id="reset-error" role="alert" className="text-xs text-red-600">
                    {resetError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary-action"
                onClick={() => void handleResetPassword()}
              >
                Update password <StudioIcon name="arrow" />
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors: { username?: string; password?: string } = {};
    if (username.trim().length < 3) errors.username = "Must be at least 3 characters.";
    if (password.length < 4) errors.password = "Must be at least 4 characters.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
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
    <form onSubmit={handleSubmit} className="create-user-card" aria-label="Create new user">
      <div>
        <p className="section-kicker">New account</p>
        <h2>Create User</h2>
      </div>
      <label>
        Username
        <input
          type="text"
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={submitting}
          aria-describedby={fieldErrors.username ? "new-username-error" : undefined}
        />
        {fieldErrors.username ? (
          <span id="new-username-error" role="alert" className="text-xs text-red-600">
            {fieldErrors.username}
          </span>
        ) : null}
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          aria-describedby={fieldErrors.password ? "new-password-error" : undefined}
        />
        {fieldErrors.password ? (
          <span id="new-password-error" role="alert" className="text-xs text-red-600">
            {fieldErrors.password}
          </span>
        ) : null}
      </label>
      <label>
        Role
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as "admin" | "user")}
          disabled={submitting}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
