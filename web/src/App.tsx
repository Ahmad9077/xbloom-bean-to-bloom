import { useState } from "react";
import { analyzeImage } from "./api.js";
import BrewModeSelector from "./components/BrewModeSelector.js";
import ImageUpload from "./components/ImageUpload.js";
import RecipeResult from "./components/RecipeResult.js";
import StepProgress from "./components/StepProgress.js";
import type { BrewMode, Recipe, WorkerResponse } from "./types.js";

type Stage =
  | { kind: "upload" }
  | { kind: "loading" }
  | { kind: "result"; recipe: Recipe; requestId: string }
  | { kind: "error"; message: string; requestId?: string };

const MAX_RETRIES = 2;

const UPLOAD_STEPS = [
  { label: "Photo", status: "active" as const },
  { label: "Recipe", status: "next" as const },
  { label: "xBloom", status: "next" as const },
];

const LOADING_STEPS = [
  { label: "Photo", status: "complete" as const },
  { label: "Recipe", status: "active" as const },
  { label: "xBloom", status: "next" as const },
];

export default function App() {
  const [brewMode, setBrewMode] = useState<BrewMode>("cold");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "upload" });
  const [retryCount, setRetryCount] = useState(0);

  function reset() {
    setFile(null);
    setBrewMode("cold");
    setRetryCount(0);
    setStage({ kind: "upload" });
  }

  async function submit(imageFile: File, mode: BrewMode, attempt = 0) {
    setStage({ kind: "loading" });

    let response: WorkerResponse;
    try {
      response = await analyzeImage(imageFile, mode);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        setRetryCount(attempt + 1);
        submit(imageFile, mode, attempt + 1);
        return;
      }
      const message =
        err instanceof Error ? err.message : "Network error. Check your connection and try again.";
      setStage({ kind: "error", message });
      return;
    }

    if (!response.ok) {
      setStage({
        kind: "error",
        message: response.error.message,
        requestId: response.requestId,
      });
      return;
    }

    setStage({ kind: "result", recipe: response.recipe, requestId: response.requestId });
  }

  function handleSubmit() {
    if (!file) return;
    setRetryCount(0);
    submit(file, brewMode);
  }

  if (stage.kind === "result") {
    return <RecipeResult recipe={stage.recipe} requestId={stage.requestId} onStartOver={reset} />;
  }

  const steps = stage.kind === "loading" ? LOADING_STEPS : UPLOAD_STEPS;

  return (
    <main className="min-h-screen bg-ivory flex flex-col items-center px-4 py-8">
      <header className="mb-6 text-center">
        <h1 className="font-heading text-4xl md:text-5xl text-espresso mb-1">Bean to Bloom</h1>
        <p className="font-body text-sage text-xs font-semibold uppercase tracking-widest">
          For xBloom Studio
        </p>
      </header>

      <div className="w-full max-w-md mb-6">
        <StepProgress steps={steps} />
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* Step 1 — brew mode selection */}
        <section aria-labelledby="mode-heading">
          <h2
            id="mode-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            How do you want your coffee?
          </h2>
          <BrewModeSelector
            value={brewMode}
            onChange={setBrewMode}
            disabled={stage.kind === "loading"}
          />
        </section>

        {/* Step 2 — image upload */}
        <section aria-labelledby="upload-heading">
          <h2
            id="upload-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Upload your bean bag photo
          </h2>
          <ImageUpload file={file} onChange={setFile} disabled={stage.kind === "loading"} />
        </section>

        {/* Privacy note */}
        <p className="text-xs text-sage text-center">
          Your photo is analysed to extract bean details and is not stored.
        </p>

        {/* Error message */}
        {stage.kind === "error" && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-700"
          >
            <p className="font-semibold mb-1">Something went wrong</p>
            <p>{stage.message}</p>
            {stage.requestId && (
              <p className="mt-1 text-xs text-red-500">Request ID: {stage.requestId}</p>
            )}
          </div>
        )}

        {/* Loading state */}
        {stage.kind === "loading" && (
          <output aria-live="polite" className="flex flex-col items-center gap-3 py-6">
            <div
              className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm text-sage">
              {retryCount > 0
                ? `Retrying… (attempt ${retryCount + 1})`
                : "Analysing your coffee bag…"}
            </p>
          </output>
        )}

        {/* Submit button */}
        {stage.kind !== "loading" && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!file}
            className="w-full min-h-touch bg-espresso text-ivory font-body font-semibold rounded-card
                       py-4 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed
                       hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-terracotta"
          >
            Create my recipe
          </button>
        )}
      </div>
    </main>
  );
}
