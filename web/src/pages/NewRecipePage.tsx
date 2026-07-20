import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiConfirmRecipe, apiCreateRecipe, compressImage } from "../api.js";
import ConfirmationDialog from "../components/ConfirmationDialog.js";
import MultiPhotoUpload from "../components/MultiPhotoUpload.js";
import type {
  BrewMode,
  BrewStrength,
  ConfirmationRecipeDetails,
  PendingRecipeConfirmation,
} from "../types.js";

type Stage =
  | { kind: "upload" }
  | { kind: "compressing" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string; code?: string };

function Icon({ name, size = 20 }: { name: "arrow" | "check" | "link"; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "check") {
    return (
      <svg {...common}>
        <title>Selected</title>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }
  if (name === "link") {
    return (
      <svg {...common}>
        <title>Product link</title>
        <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <title>Continue</title>
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function BrewChoice<T extends string>({
  name,
  label,
  helper,
  value,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  label: string;
  helper: string;
  value: T;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <label className={`choice-card ${selected ? "is-selected" : ""}`}>
      <input
        className="sr-only"
        type="radio"
        name={name}
        value={value}
        checked={selected}
        disabled={disabled}
        aria-label={label}
        onChange={() => onSelect(value)}
      />
      <span className="choice-indicator" aria-hidden="true">
        {selected ? <Icon name="check" size={15} /> : null}
      </span>
      <span className="choice-label">{label}</span>
      <span className="choice-helper">{helper}</span>
    </label>
  );
}

function isPendingConfirmation(
  value: Awaited<ReturnType<typeof apiCreateRecipe>>,
): value is PendingRecipeConfirmation {
  return "needsConfirmation" in value && value.needsConfirmation === true;
}

function startErrorMessage(error: unknown): { message: string; code?: string } {
  if (error instanceof ApiError) {
    if (error.code === "RECIPE_UPSTREAM_MALFORMED" || error.code === "RECIPE_UPSTREAM_ERROR") {
      return {
        message:
          "We read the coffee bag, but couldn't create a usable recipe recommendation. Please try again.",
        code: error.code,
      };
    }
    if (error.code === "UPSTREAM_MALFORMED" || error.code === "UPSTREAM_ERROR") {
      return {
        message: "We couldn't complete the AI analysis right now. Please try again.",
        code: error.code,
      };
    }
    return { message: error.message, code: error.code };
  }
  return {
    message:
      error instanceof Error
        ? error.message
        : "Network error. Check your connection and try again.",
  };
}

function confirmationErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    [
      "UPSTREAM_MALFORMED",
      "UPSTREAM_ERROR",
      "RECIPE_UPSTREAM_MALFORMED",
      "RECIPE_UPSTREAM_ERROR",
    ].includes(error.code)
  ) {
    return "The recipe recommendation service did not return a usable recipe. Please try again.";
  }
  return error instanceof Error ? error.message : "Could not create the recipe. Please try again.";
}

export default function NewRecipePage() {
  const navigate = useNavigate();
  const productLinkRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const scanInFlightRef = useRef(false);
  const confirmationInFlightRef = useRef(false);
  const heroVisualRef = useRef<HTMLDivElement>(null);
  const cupRef = useRef<HTMLDivElement>(null);
  const orbitOneRef = useRef<HTMLDivElement>(null);
  const orbitTwoRef = useRef<HTMLDivElement>(null);
  const beanOneRef = useRef<HTMLDivElement>(null);
  const beanTwoRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const aromaRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const [brewMode, setBrewMode] = useState<BrewMode>("cold");
  const [strength, setStrength] = useState<BrewStrength>("strong");
  const [files, setFiles] = useState<File[]>([]);
  const [productLink, setProductLink] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "upload" });
  const [confirmation, setConfirmation] = useState<PendingRecipeConfirmation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string>();

  const isLoading = stage.kind === "loading" || stage.kind === "compressing";
  const canCreate = files.length > 0 || productLink.trim().length > 0;

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    let frameId: number | undefined;
    let isVisible = true;

    function resetMotion() {
      for (const ref of [
        cupRef,
        orbitOneRef,
        orbitTwoRef,
        beanOneRef,
        beanTwoRef,
        ticketRef,
        aromaRef,
        shadowRef,
      ]) {
        ref.current?.style.removeProperty("transform");
        ref.current?.style.removeProperty("opacity");
      }
    }

    function updateMotion() {
      frameId = undefined;
      if (!heroVisualRef.current || reduceMotion?.matches) {
        resetMotion();
        return;
      }

      const distance = Math.min(540, Math.max(460, window.innerHeight * 0.62));
      const progress = Math.min(1, Math.max(0, window.scrollY / distance));
      const easedProgress = progress * progress * (3 - 2 * progress);

      if (cupRef.current) {
        cupRef.current.style.transform = `translate3d(${(10 * easedProgress).toFixed(2)}px, ${(-18 * easedProgress).toFixed(2)}px, 0) perspective(400px) rotateX(-8deg) rotateZ(${(2 - 12 * easedProgress).toFixed(2)}deg)`;
      }
      if (orbitOneRef.current) {
        orbitOneRef.current.style.transform = `translate3d(${(-14 * easedProgress).toFixed(2)}px, ${(10 * easedProgress).toFixed(2)}px, 0) rotate(${(-12 - 16 * easedProgress).toFixed(2)}deg)`;
      }
      if (orbitTwoRef.current) {
        orbitTwoRef.current.style.transform = `translate3d(${(16 * easedProgress).toFixed(2)}px, ${(-12 * easedProgress).toFixed(2)}px, 0) rotate(${(15 + 18 * easedProgress).toFixed(2)}deg)`;
      }
      if (beanOneRef.current) {
        beanOneRef.current.style.transform = `translate3d(${(32 * easedProgress).toFixed(2)}px, ${(-22 * easedProgress).toFixed(2)}px, 0) rotate(${(28 + 34 * easedProgress).toFixed(2)}deg)`;
      }
      if (beanTwoRef.current) {
        beanTwoRef.current.style.transform = `translate3d(${(-28 * easedProgress).toFixed(2)}px, ${(18 * easedProgress).toFixed(2)}px, 0) scale(0.72) rotate(${(-22 - 30 * easedProgress).toFixed(2)}deg)`;
      }
      if (ticketRef.current) {
        ticketRef.current.style.transform = `translate3d(${(-18 * easedProgress).toFixed(2)}px, ${(-26 * easedProgress).toFixed(2)}px, 0) rotate(${(-2 + 6 * easedProgress).toFixed(2)}deg)`;
      }
      if (aromaRef.current) {
        aromaRef.current.style.transform = `translate3d(0, ${(-20 * easedProgress).toFixed(2)}px, 0)`;
        aromaRef.current.style.opacity = String(0.64 + 0.28 * easedProgress);
      }
      if (shadowRef.current) {
        shadowRef.current.style.transform = `translate3d(0, ${(7 * easedProgress).toFixed(2)}px, 0) scaleX(${(1 - 0.24 * easedProgress).toFixed(3)})`;
        shadowRef.current.style.opacity = String(0.48 - 0.21 * easedProgress);
      }
    }

    function scheduleMotion() {
      if (!isVisible || frameId !== undefined) return;
      frameId = window.requestAnimationFrame(updateMotion);
    }

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            isVisible = entries[0]?.isIntersecting ?? false;
            if (isVisible) scheduleMotion();
          });

    updateMotion();
    if (heroVisualRef.current) observer?.observe(heroVisualRef.current);
    window.addEventListener("scroll", scheduleMotion, { passive: true });
    window.addEventListener("resize", scheduleMotion);
    reduceMotion?.addEventListener?.("change", scheduleMotion);

    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleMotion);
      window.removeEventListener("resize", scheduleMotion);
      reduceMotion?.removeEventListener?.("change", scheduleMotion);
      observer?.disconnect();
    };
  }, []);

  async function handleSubmit() {
    const normalizedProductLink = productLink.trim();
    if (!canCreate || isLoading || scanInFlightRef.current) return;
    scanInFlightRef.current = true;

    let compressed: File[] = [];
    if (files.length > 0) {
      setStage({ kind: "compressing" });
      try {
        compressed = await Promise.all(files.map(compressImage));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process images.";
        setStage({ kind: "error", message });
        setFiles([]);
        scanInFlightRef.current = false;
        return;
      }
    }

    setStage({
      kind: "loading",
      message: files.length > 0 ? "Analysing your coffee bag…" : "Reading the product link…",
    });

    try {
      const result = await apiCreateRecipe(compressed, brewMode, strength, normalizedProductLink);
      setFiles([]);
      setProductLink("");
      if (isPendingConfirmation(result)) {
        setConfirmation(result);
        setConfirmationError(undefined);
        setStage({ kind: "upload" });
        return;
      }
      navigate(`/recipes/${result.id}`);
    } catch (error) {
      const failure = startErrorMessage(error);
      setStage({ kind: "error", ...failure });
      setFiles([]);
    } finally {
      scanInFlightRef.current = false;
    }
  }

  async function handlePaste() {
    if (!navigator.clipboard?.readText) {
      focusProductLink();
      return;
    }
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (!value) {
        focusProductLink();
        return;
      }
      setProductLink(value);
      setStage({ kind: "upload" });
    } catch {
      focusProductLink();
    }
  }

  function focusProductLink() {
    const input = productLinkRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {
      // Some mobile URL inputs do not support selection ranges.
    }
  }

  async function handleConfirm(
    storeName: string,
    beanName: string,
    details: ConfirmationRecipeDetails,
  ) {
    if (!confirmation || confirming || confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    setConfirming(true);
    setConfirmationError(undefined);
    try {
      const result = await apiConfirmRecipe(
        confirmation.confirmationId,
        storeName,
        beanName,
        details,
      );
      if (result.cached) {
        try {
          sessionStorage.setItem("xbloom:cachedRecipe", result.id);
        } catch {
          // Navigation must not depend on browser storage availability.
        }
      }
      navigate(`/recipes/${result.id}`);
    } catch (error) {
      setConfirmationError(confirmationErrorMessage(error));
      setConfirming(false);
    } finally {
      confirmationInFlightRef.current = false;
    }
  }

  function handleCancelConfirmation() {
    if (confirming) return;
    setConfirmation(null);
    setConfirmationError(undefined);
  }

  return (
    <main className="new-recipe-page">
      <section className="studio-hero" aria-labelledby="new-recipe-title">
        <div className="hero-copy">
          <p className="eyebrow">For xBloom Studio</p>
          <h1 id="new-recipe-title">Bean to Bloom</h1>
          <p className="hero-lede">
            Turn a bag photo or roaster link into a ready-to-brew xBloom recipe.
          </p>
          <div className="process-line" aria-label="Recipe creation steps">
            <span>
              <b>01</b> Choose your cup
            </span>
            <span>
              <b>02</b> Add the bean
            </span>
            <span>
              <b>03</b> Confirm and brew
            </span>
          </div>
          <div ref={heroVisualRef} className="hero-visual" aria-hidden="true">
            <div className="hero-glow" />
            <div ref={shadowRef} className="cup-shadow" />
            <div ref={aromaRef} className="aroma-lines">
              <span />
              <span />
              <span />
            </div>
            <div ref={cupRef} className="v60-cone">
              <span />
              <span />
              <span />
              <i className="coffee-bed" />
            </div>
            <div ref={orbitOneRef} className="brew-orbit orbit-one" />
            <div ref={orbitTwoRef} className="brew-orbit orbit-two" />
            <div ref={beanOneRef} className="bean bean-one" />
            <div ref={beanTwoRef} className="bean bean-two" />
            <div ref={ticketRef} className="hero-ticket">
              <small>Today&apos;s setup</small>
              <strong>{brewMode === "cold" ? "V60 over ice" : "V60 hot"}</strong>
              <span>{strength === "strong" ? "Strong" : "Soft"} cup</span>
            </div>
          </div>
        </div>

        <div className="recipe-form-card">
          <div className="card-heading-row">
            <div>
              <p className="section-kicker">Cup setup</p>
              <h2>How do you want your coffee?</h2>
            </div>
            <span className="method-chip">V60</span>
          </div>

          <div className="choice-zone">
            <fieldset>
              <legend>Temperature</legend>
              <div className="choice-grid">
                <BrewChoice
                  name="brew-mode"
                  label="Cold"
                  helper="V60 over ice"
                  value="cold"
                  selected={brewMode === "cold"}
                  disabled={isLoading}
                  onSelect={setBrewMode}
                />
                <BrewChoice
                  name="brew-mode"
                  label="Hot"
                  helper="V60 hot"
                  value="hot"
                  selected={brewMode === "hot"}
                  disabled={isLoading}
                  onSelect={setBrewMode}
                />
              </div>
            </fieldset>
            <fieldset>
              <legend>Strength</legend>
              <div className="choice-grid">
                <BrewChoice
                  name="brew-strength"
                  label="Strong"
                  helper="Fuller & bolder"
                  value="strong"
                  selected={strength === "strong"}
                  disabled={isLoading}
                  onSelect={setStrength}
                />
                <BrewChoice
                  name="brew-strength"
                  label="Soft"
                  helper="Lighter & calmer"
                  value="soft"
                  selected={strength === "soft"}
                  disabled={isLoading}
                  onSelect={setStrength}
                />
              </div>
            </fieldset>
          </div>

          <section className="bean-source-card" aria-labelledby="upload-heading">
            <div className="source-heading">
              <div>
                <p className="section-kicker">Bean source</p>
                <h3 id="upload-heading">Upload bean bag photos</h3>
              </div>
              <span>{files.length}/4</span>
            </div>

            <MultiPhotoUpload files={files} onChange={setFiles} disabled={isLoading} />

            <div className="source-divider">
              <span>Or paste product link</span>
            </div>
            <div className="link-row">
              <span className="link-field-icon">
                <Icon name="link" size={18} />
              </span>
              <label className="sr-only" htmlFor="product-link">
                Product link
              </label>
              <input
                ref={productLinkRef}
                id="product-link"
                aria-label="Product link"
                type="url"
                inputMode="url"
                value={productLink}
                onChange={(event) => setProductLink(event.target.value)}
                placeholder="https://…"
                disabled={isLoading}
              />
              <button type="button" onClick={handlePaste} disabled={isLoading}>
                Paste
              </button>
            </div>
            {files.length > 0 && productLink.trim() ? (
              <p className="upload-hint">
                Photos will be used for this request. Remove the photos if you want to use the
                product link instead.
              </p>
            ) : null}
          </section>

          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            <p>Your photos are analysed to extract bean details and are not stored.</p>
          </div>

          {stage.kind === "error" ? (
            <div
              role="alert"
              className="form-alert rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <p className="mb-1 font-semibold">Something went wrong</p>
              <p>{stage.message}</p>
              {stage.code ? (
                <p className="mt-1 text-xs text-red-500">Error code: {stage.code}</p>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <output aria-live="polite" className="form-status">
              <span className="form-spinner" aria-hidden="true" />
              <span>{stage.kind === "compressing" ? "Preparing photos…" : stage.message}</span>
            </output>
          ) : null}

          <button
            ref={submitButtonRef}
            type="button"
            className="primary-action"
            disabled={!canCreate || isLoading}
            onClick={handleSubmit}
          >
            <span>{isLoading ? "Creating recipe…" : "Create my recipe"}</span>
            <Icon name="arrow" />
          </button>
          {!canCreate && !isLoading ? (
            <p className="action-hint">Add photos or a product page link to continue</p>
          ) : null}
        </div>
      </section>

      {confirmation ? (
        <ConfirmationDialog
          key={confirmation.confirmationId}
          confirmation={confirmation}
          submitting={confirming}
          error={confirmationError}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirmation}
          returnFocusRef={submitButtonRef}
        />
      ) : null}
    </main>
  );
}
