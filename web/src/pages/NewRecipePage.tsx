import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiCreateRecipe, apiGetRecommendation, compressImage } from "../api.js";
import BrewModeSelector from "../components/BrewModeSelector.js";
import MultiPhotoUpload from "../components/MultiPhotoUpload.js";
import StepProgress from "../components/StepProgress.js";
import type { BrewMode } from "../types.js";

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

type Stage =
  | { kind: "upload" }
  | { kind: "compressing" }
  | { kind: "loading"; message?: string }
  | { kind: "error"; message: string; code?: string };

export default function NewRecipePage() {
  const navigate = useNavigate();
  const [brewMode, setBrewMode] = useState<BrewMode>("cold");
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: "upload" });

  async function handleSubmit() {
    if (files.length === 0) return;
    setStage({ kind: "compressing" });

    let compressed: File[];
    try {
      compressed = await Promise.all(files.map(compressImage));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to process images.";
      setStage({ kind: "error", message: msg });
      setFiles([]);
      return;
    }

    setStage({ kind: "loading", message: "Analysing your coffee bag…" });

    try {
      const result = await apiCreateRecipe(compressed, brewMode);
      setFiles([]);
      setStage({ kind: "loading", message: "Codex is designing a bean-specific recipe…" });
      const recipeId = await waitForRecommendation(result.job.id);
      navigate(`/recipes/${recipeId}`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Network error. Check your connection and try again.";
      const code = err instanceof ApiError ? err.code : undefined;
      setStage({ kind: "error", message, code });
      setFiles([]);
    }
  }

  const isLoading = stage.kind === "loading" || stage.kind === "compressing";
  const steps = isLoading ? LOADING_STEPS : UPLOAD_STEPS;

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
        {/* Step 1 — brew mode */}
        <section aria-labelledby="mode-heading">
          <h2
            id="mode-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            How do you want your coffee?
          </h2>
          <BrewModeSelector value={brewMode} onChange={setBrewMode} disabled={isLoading} />
        </section>

        {/* Step 2 — photos */}
        <section aria-labelledby="upload-heading">
          <h2
            id="upload-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Upload bean bag photos
          </h2>
          <MultiPhotoUpload files={files} onChange={setFiles} disabled={isLoading} />
        </section>

        <p className="text-xs text-sage text-center">
          Your photos are analysed to extract bean details and are not stored.
        </p>

        {/* Error */}
        {stage.kind === "error" && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-700"
          >
            <p className="font-semibold mb-1">Something went wrong</p>
            <p>{stage.message}</p>
            {stage.code && <p className="mt-1 text-xs text-red-500">Error code: {stage.code}</p>}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <output aria-live="polite" className="flex flex-col items-center gap-3 py-6">
            <div
              className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm text-sage">
              {stage.kind === "compressing" ? "Preparing photos…" : stage.message}
            </p>
          </output>
        )}

        {/* Submit */}
        {!isLoading && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={files.length === 0}
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

async function waitForRecommendation(jobId: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const job = await apiGetRecommendation(jobId);
    if (job.status === "completed" && job.recipeId) return job.recipeId;
    if (job.status === "failed") {
      throw new Error(job.safeError || "Codex could not create this recipe. Please try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error("Recipe recommendation timed out. Please try again.");
}
