import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import { useAuth } from "../context/AuthContext.js";

function fieldError(err: ApiError, field: "username" | "password"): string | null {
  if (err.status === 422) {
    const msg = err.message.toLowerCase();
    if (field === "username" && msg.includes("username")) return err.message;
    if (field === "password" && msg.includes("password")) return err.message;
  }
  return null;
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-ivory flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  function validateLocally(): boolean {
    let ok = true;
    setUsernameError(null);
    setPasswordError(null);
    setGlobalError(null);

    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setUsernameError("Username is required.");
      ok = false;
    } else if (trimmed.length < 3) {
      setUsernameError("Username must be at least 3 characters.");
      ok = false;
    }

    if (password.length === 0) {
      setPasswordError("Password is required.");
      ok = false;
    } else if (password.length < 12) {
      setPasswordError("Password must be at least 12 characters.");
      ok = false;
    }

    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateLocally()) return;
    setSubmitting(true);
    setGlobalError(null);
    setUsernameError(null);
    setPasswordError(null);

    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setGlobalError("Invalid username or password.");
        } else if (err.status === 429) {
          setGlobalError("Too many login attempts. Please wait a few minutes and try again.");
        } else if (err.status === 422) {
          const uErr = fieldError(err, "username");
          const pErr = fieldError(err, "password");
          if (uErr) setUsernameError(uErr);
          else if (pErr) setPasswordError(pErr);
          else setGlobalError(err.message);
        } else {
          setGlobalError(err.message);
        }
      } else {
        setGlobalError("Network error. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-ivory flex flex-col items-center justify-center px-4 py-8">
      <header className="mb-8 text-center">
        <h1 className="font-heading text-4xl md:text-5xl text-espresso mb-1">Bean to Bloom</h1>
        <p className="font-body text-sage text-xs font-semibold uppercase tracking-widest">
          For xBloom Studio
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-sm space-y-5"
        aria-label="Login form"
      >
        {globalError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-700"
          >
            {globalError}
          </div>
        )}

        <div className="space-y-1">
          <label
            htmlFor="username"
            className="block font-body text-xs font-semibold uppercase tracking-widest text-sage"
          >
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            aria-describedby={usernameError ? "username-error" : undefined}
            aria-invalid={usernameError ? "true" : undefined}
            className={`w-full min-h-touch px-4 rounded-card border bg-white font-body text-sm
                        text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta
                        disabled:opacity-50
                        ${usernameError ? "border-red-400" : "border-espresso/20"}`}
          />
          {usernameError && (
            <p id="username-error" role="alert" className="text-xs text-red-600">
              {usernameError}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="password"
            className="block font-body text-xs font-semibold uppercase tracking-widest text-sage"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            aria-describedby={passwordError ? "password-error" : undefined}
            aria-invalid={passwordError ? "true" : undefined}
            className={`w-full min-h-touch px-4 rounded-card border bg-white font-body text-sm
                        text-espresso focus:outline-none focus:ring-2 focus:ring-terracotta
                        disabled:opacity-50
                        ${passwordError ? "border-red-400" : "border-espresso/20"}`}
          />
          {passwordError && (
            <p id="password-error" role="alert" className="text-xs text-red-600">
              {passwordError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-touch bg-espresso text-ivory font-body font-semibold rounded-card
                     py-4 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed
                     hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-terracotta"
        >
          {submitting ? "Signing in…" : "Login"}
        </button>
      </form>
    </main>
  );
}
