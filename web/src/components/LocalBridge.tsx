import { useRef, useState } from "react";
import { checkBridge, saveRecipe } from "../api.js";
import type { BridgeResponse, Recipe } from "../types.js";

type BridgeStage =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "saving" }
  | { kind: "saved"; recipeName: string }
  | { kind: "error"; message: string };

interface Props {
  recipe: Recipe;
  idempotencyKey: string;
}

export default function LocalBridge({ recipe, idempotencyKey }: Props) {
  const [stage, setStage] = useState<BridgeStage>({ kind: "idle" });
  const startedRef = useRef(false);

  async function handleSave() {
    if (startedRef.current) return;
    startedRef.current = true;

    setStage({ kind: "checking" });
    const available = await checkBridge();
    if (!available) {
      setStage({ kind: "unavailable" });
      startedRef.current = false;
      return;
    }

    setStage({ kind: "saving" });
    let response: BridgeResponse;
    try {
      response = await saveRecipe(recipe, idempotencyKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error saving recipe.";
      setStage({ kind: "error", message: msg });
      startedRef.current = false;
      return;
    }

    if (response.ok) {
      setStage({ kind: "saved", recipeName: response.recipeName });
    } else {
      setStage({ kind: "error", message: response.error.message });
      startedRef.current = false;
    }
  }

  function retry() {
    startedRef.current = false;
    setStage({ kind: "idle" });
  }

  return (
    <div className="space-y-3">
      {stage.kind === "idle" && (
        <>
          <button
            type="button"
            onClick={handleSave}
            className="w-full min-h-touch bg-sage text-ivory font-body font-semibold rounded-card
                       py-4 transition-opacity hover:opacity-90 focus-visible:outline-2
                       focus-visible:outline-offset-2 focus-visible:outline-terracotta"
          >
            Add to my xBloom
          </button>
          <p className="text-xs text-center text-espresso/50">
            Requires the Mac emulator bridge running locally. This will save the recipe to xBloom
            Studio on the connected device.
          </p>
        </>
      )}

      {stage.kind === "checking" && (
        <output aria-live="polite" className="flex items-center gap-3 py-3 text-sm text-sage">
          <span
            className="w-5 h-5 rounded-full border-2 border-sage border-t-terracotta animate-spin"
            aria-hidden="true"
          />
          Checking bridge…
        </output>
      )}

      {stage.kind === "unavailable" && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-amber-50 border border-amber-200 rounded-card p-4 space-y-2"
        >
          <p className="text-sm font-semibold text-amber-800">Bridge not available</p>
          <p className="text-xs text-amber-700">
            The Mac emulator bridge is not running. Start it with{" "}
            <code className="bg-amber-100 px-1 rounded">cd local-service &amp;&amp; npm start</code>{" "}
            on your Mac, then try again.
          </p>
          <button
            type="button"
            onClick={retry}
            className="text-xs underline text-amber-700 hover:text-amber-900 focus-visible:outline-2"
          >
            Try again
          </button>
        </div>
      )}

      {stage.kind === "saving" && (
        <output aria-live="polite" className="flex items-center gap-3 py-3 text-sm text-sage">
          <span
            className="w-5 h-5 rounded-full border-2 border-sage border-t-terracotta animate-spin"
            aria-hidden="true"
          />
          Saving to xBloom Studio…
        </output>
      )}

      {stage.kind === "saved" && (
        <output
          aria-live="polite"
          className="block bg-green-50 border border-green-200 rounded-card p-4"
        >
          <p className="text-sm font-semibold text-green-800">✓ Saved — {stage.recipeName}</p>
          <p className="text-xs text-green-700 mt-1">The recipe has been added to xBloom Studio.</p>
        </output>
      )}

      {stage.kind === "error" && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-50 border border-red-200 rounded-card p-4 space-y-2"
        >
          <p className="text-sm font-semibold text-red-800">Save failed</p>
          <p className="text-xs text-red-700">{stage.message}</p>
          <button
            type="button"
            onClick={retry}
            className="text-xs underline text-red-700 hover:text-red-900 focus-visible:outline-2"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
