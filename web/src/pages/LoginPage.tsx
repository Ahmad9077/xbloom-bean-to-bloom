import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import StudioIcon from "../components/StudioIcon.js";
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
      <div className="app-shell min-h-screen flex items-center justify-center">
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
    } else if (password.length < 4) {
      setPasswordError("Password must be at least 4 characters.");
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
    <div className="app-shell">
      <main className="new-recipe-page">
        <section className="studio-hero" aria-labelledby="login-brand">
          <div className="hero-copy">
            <p className="eyebrow">For xBloom Studio</p>
            <h1 id="login-brand">Bean to Bloom</h1>
            <div className="hero-visual" aria-hidden="true">
              <div className="v60-cone">
                <span />
                <span />
                <span />
              </div>
              <div className="brew-orbit orbit-one" />
              <div className="brew-orbit orbit-two" />
              <div className="bean bean-one" />
              <div className="bean bean-two" />
              <div className="hero-ticket">
                <small>Bean to Bloom</small>
                <strong>V60 recipes</strong>
                <span>For xBloom Studio</span>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="recipe-form-card"
            aria-label="Login form"
          >
            <div className="card-heading-row">
              <div>
                <p className="section-kicker">Account access</p>
                <h2>Login</h2>
              </div>
              <span className="method-chip">V60</span>
            </div>

            {globalError ? (
              <div
                role="alert"
                className="content-section bg-red-50 border-red-200 text-sm text-red-700"
              >
                {globalError}
              </div>
            ) : null}

            <div className="field-grid">
              <label htmlFor="username">
                Username
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={submitting}
                  aria-describedby={usernameError ? "username-error" : undefined}
                  aria-invalid={usernameError ? "true" : undefined}
                  className={usernameError ? "border-red-400" : undefined}
                />
                {usernameError ? (
                  <span id="username-error" role="alert" className="text-xs text-red-600">
                    {usernameError}
                  </span>
                ) : null}
              </label>

              <label htmlFor="password">
                Password
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  aria-describedby={passwordError ? "password-error" : undefined}
                  aria-invalid={passwordError ? "true" : undefined}
                  className={passwordError ? "border-red-400" : undefined}
                />
                {passwordError ? (
                  <span id="password-error" role="alert" className="text-xs text-red-600">
                    {passwordError}
                  </span>
                ) : null}
              </label>
            </div>

            <button type="submit" disabled={submitting} className="primary-action">
              <span>{submitting ? "Signing in…" : "Login"}</span>
              <StudioIcon name="arrow" />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
