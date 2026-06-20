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
        const initialJob = await apiCreateBridgeJob(recipeId);
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
      <output aria-live="polite" className="flex items-center gap-3 py-3 text-sm text-sage">
        <span
          className="w-5 h-5 rounded-full border-2 border-sage border-t-terracotta animate-spin flex-shrink-0"
          aria-hidden="true"
        />
        Preparing your xBloom link…
      </output>
    );
  }

  if (state.kind === "pending") {
    return (
      <output aria-live="polite">
        <div className="flex items-center gap-3 py-2 text-sm text-sage">
          <span
            className="w-5 h-5 rounded-full border-2 border-sage border-t-terracotta animate-spin flex-shrink-0"
            aria-hidden="true"
          />
          Creating your xBloom link…
        </div>
      </output>
    );
  }

  if (state.kind === "claimed") {
    return (
      <output aria-live="polite" className="flex items-center gap-3 py-3 text-sm text-sage">
        <span
          className="w-5 h-5 rounded-full border-2 border-sage border-t-terracotta animate-spin flex-shrink-0"
          aria-hidden="true"
        />
        Creating your xBloom link… This may take a few minutes.
      </output>
    );
  }

  if (state.kind === "completed") {
    return (
      <output
        aria-live="polite"
        className="block bg-green-50 border border-green-200 rounded-card p-4"
      >
        <p className="text-sm font-semibold text-green-800">✓ Your xBloom link is ready</p>
        {state.shareLink && (
          <a
            href={state.shareLink}
            className="mt-4 flex min-h-touch items-center justify-center rounded-card bg-espresso px-4 py-3 text-sm font-semibold text-ivory"
          >
            Add recipe in xBloom app
          </a>
        )}
      </output>
    );
  }

  if (state.kind === "failed") {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 rounded-card p-4 space-y-1">
        <p className="text-sm font-semibold text-red-800">Could not create the xBloom link</p>
        <p className="text-xs text-red-600/70 mt-1">
          Please try again. When it is ready, a button will open the recipe directly in xBloom.
        </p>
        <button
          type="button"
          onClick={retryDelivery}
          className="mt-3 flex min-h-touch w-full items-center justify-center rounded-card bg-espresso px-4 py-3 text-sm font-semibold text-ivory"
        >
          Retry and create xBloom link
        </button>
      </div>
    );
  }

  // apiError
  return (
    <div role="alert" className="bg-amber-50 border border-amber-200 rounded-card p-4 space-y-1">
      <p className="text-sm font-semibold text-amber-800">xBloom link unavailable</p>
      <p className="text-xs text-amber-700">{state.message}</p>
    </div>
  );
}
