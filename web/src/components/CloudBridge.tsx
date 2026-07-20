import { useEffect, useRef, useState } from "react";
import { ApiError, apiCreateBridgeJob, apiGetBridgeJob } from "../api.js";
import type { BridgeJob } from "../types.js";

type CloudBridgeState =
  | { kind: "enqueuing" }
  | { kind: "pending" }
  | { kind: "claimed" }
  | { kind: "completed"; shareLink?: string }
  | { kind: "failed"; error?: string }
  | { kind: "apiError"; message: string };

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 72; // 6 minutes

interface Props {
  recipeId: string;
}

export default function CloudBridge({ recipeId }: Props) {
  const [state, setState] = useState<CloudBridgeState>({ kind: "enqueuing" });
  const [retryNonce, setRetryNonce] = useState(0);
  const pollsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (retryNonce > 0) pollsRef.current = 0;

    async function startPolling() {
      // Create or retrieve the bridge job (idempotent)
      try {
        const initialJob = await apiCreateBridgeJob(recipeId, retryNonce > 0);
        if (!mountedRef.current) return;
        if (applyJob(initialJob)) return;
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof ApiError ? err.message : "Could not queue bridge job.";
        setState({ kind: "apiError", message: msg });
        return;
      }

      function scheduleNext() {
        timerRef.current = setTimeout(() => poll(), POLL_INTERVAL_MS);
      }

      async function poll() {
        if (!mountedRef.current) return;
        if (pollsRef.current >= MAX_POLLS) return;
        pollsRef.current++;

        let job: BridgeJob | null;
        try {
          job = await apiGetBridgeJob(recipeId);
        } catch {
          scheduleNext();
          return;
        }

        if (!mountedRef.current) return;

        if (!job) {
          scheduleNext();
          return;
        }

        if (!applyJob(job)) scheduleNext();
      }

      scheduleNext();
    }

    startPolling();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [recipeId, retryNonce]);

  function retryDelivery() {
    setState({ kind: "enqueuing" });
    setRetryNonce((value) => value + 1);
  }

  function applyJob(job: BridgeJob): boolean {
    switch (job.status) {
      case "pending":
        setState({ kind: "pending" });
        return false;
      case "claimed":
        setState({ kind: "claimed" });
        return false;
      case "completed":
        setState({ kind: "completed", shareLink: job.shareLink ?? undefined });
        return true;
      case "failed":
        setState({ kind: "failed", error: job.safeError ?? undefined });
        return true;
    }
  }

  if (state.kind === "enqueuing") {
    return (
      <section className="delivery-card" aria-labelledby="delivery-heading">
        <div className="delivery-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker light">Send to xBloom Studio</p>
        <output aria-live="polite">
          <h2 id="delivery-heading">Preparing your xBloom link</h2>
          <p>
            <span className="delivery-progress" aria-hidden="true" />
            Getting everything ready…
          </p>
        </output>
        <small>Your recipe will be ready to open directly in xBloom.</small>
      </section>
    );
  }

  if (state.kind === "pending") {
    return (
      <section className="delivery-card" aria-labelledby="delivery-heading">
        <div className="delivery-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker light">Send to xBloom Studio</p>
        <output aria-live="polite">
          <h2 id="delivery-heading">Creating your xBloom link</h2>
          <p>
            <span className="delivery-progress" aria-hidden="true" />
            Your recipe is being prepared…
          </p>
        </output>
        <small>This may take a few minutes.</small>
      </section>
    );
  }

  if (state.kind === "claimed") {
    return (
      <section className="delivery-card" aria-labelledby="delivery-heading">
        <div className="delivery-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker light">Send to xBloom Studio</p>
        <output aria-live="polite">
          <h2 id="delivery-heading">Creating your xBloom link</h2>
          <p>
            <span className="delivery-progress" aria-hidden="true" />
            Your recipe is being prepared…
          </p>
        </output>
        <small>This may take a few minutes.</small>
      </section>
    );
  }

  if (state.kind === "completed") {
    return (
      <section className="delivery-card delivery-ready" aria-labelledby="delivery-heading">
        <div className="delivery-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker light">Send to xBloom Studio</p>
        <output aria-live="polite">
          <h2 id="delivery-heading">Your xBloom link is ready</h2>
          <p>Open the recipe directly in the xBloom app and add it to your account.</p>
        </output>
        {state.shareLink && (
          <a href={state.shareLink} className="delivery-action">
            <span>Add recipe in xBloom app</span>
            <span aria-hidden="true">→</span>
          </a>
        )}
        {!state.shareLink && <small>The recipe was created, but no share link was returned.</small>}
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section
        className="delivery-card delivery-failed"
        aria-labelledby="delivery-heading"
        role="alert"
      >
        <div className="delivery-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker light">Send to xBloom Studio</p>
        <h2 id="delivery-heading">Could not create the xBloom link</h2>
        <p>Please try again. When it is ready, a button will open the recipe directly in xBloom.</p>
        <button type="button" onClick={retryDelivery}>
          <span>Retry and create xBloom link</span>
          <span aria-hidden="true">→</span>
        </button>
      </section>
    );
  }

  // apiError
  return (
    <section
      className="delivery-card delivery-failed"
      aria-labelledby="delivery-heading"
      role="alert"
    >
      <div className="delivery-icon" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="section-kicker light">Send to xBloom Studio</p>
      <h2 id="delivery-heading">xBloom link unavailable</h2>
      <p>{state.message}</p>
    </section>
  );
}
