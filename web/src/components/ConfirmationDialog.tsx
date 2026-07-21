import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ConfirmationRecipeDetails, PendingRecipeConfirmation, RoastLevel } from "../types.js";

const STORE_NAME_MAX_CHARS = 40;
const BEAN_NAME_MAX_CHARS = 60;

const COLD_DRINK_SIZES = [240, 270, 300, 330, 360] as const;
const HOT_STRONG_DRINK_SIZES = [210, 224, 238, 252, 266] as const;
const HOT_SOFT_DRINK_SIZES = [210, 225, 240, 255, 270] as const;

const PROCESSING_METHODS = [
  "washed",
  "natural",
  "honey",
  "anaerobic",
  "co-fermented",
  "infused",
] as const;

const ROAST_LEVELS: Array<{ value: RoastLevel; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "light", label: "Light" },
  { value: "medium_light", label: "Medium-light" },
  { value: "medium", label: "Medium" },
  { value: "medium_dark", label: "Medium-dark" },
  { value: "dark", label: "Dark" },
];

interface Props {
  confirmation: PendingRecipeConfirmation;
  submitting: boolean;
  error?: string;
  onConfirm: (storeName: string, beanName: string, details: ConfirmationRecipeDetails) => void;
  onCancel: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

function Icon({ name }: { name: "arrow" | "close" }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  return name === "close" ? (
    <svg {...common}>
      <title>Close</title>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ) : (
    <svg {...common}>
      <title>Continue</title>
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function limitCharacters(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function validRoastLevel(value: string | undefined): RoastLevel {
  return ROAST_LEVELS.some((option) => option.value === value) ? (value as RoastLevel) : "unknown";
}

function validProcessingMethod(value: string | undefined): string {
  return PROCESSING_METHODS.includes(value as (typeof PROCESSING_METHODS)[number])
    ? (value ?? "")
    : "";
}

export default function ConfirmationDialog({
  confirmation,
  submitting,
  error,
  onConfirm,
  onCancel,
  returnFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCancelRef = useRef(onCancel);
  const submittingRef = useRef(submitting);
  const [storeName, setStoreName] = useState(() =>
    limitCharacters(confirmation.bean.storeName ?? "", STORE_NAME_MAX_CHARS),
  );
  const [beanName, setBeanName] = useState(() =>
    limitCharacters(confirmation.bean.beanName ?? "", BEAN_NAME_MAX_CHARS),
  );
  const missingFields = new Set(
    Array.isArray(confirmation.missingFields) ? confirmation.missingFields : [],
  );
  const needsOrigin = missingFields.has("origin");
  const needsProcessingMethod = missingFields.has("processingMethod");
  const needsDescription =
    missingFields.has("description") ||
    missingFields.has("flavors") ||
    missingFields.has("flavors or description");
  const [origin, setOrigin] = useState(confirmation.bean.origin ?? "");
  const [processingMethod, setProcessingMethod] = useState(
    validProcessingMethod(confirmation.bean.processingMethod),
  );
  const [description, setDescription] = useState(
    confirmation.bean.flavors?.length
      ? confirmation.bean.flavors.join(", ")
      : (confirmation.bean.description ?? ""),
  );
  const [roastLevel, setRoastLevel] = useState<RoastLevel>(() =>
    validRoastLevel(confirmation.bean.roastLevel),
  );

  const drinkSizes =
    confirmation.brewMode === "cold"
      ? COLD_DRINK_SIZES
      : confirmation.strength === "strong"
        ? HOT_STRONG_DRINK_SIZES
        : HOT_SOFT_DRINK_SIZES;
  const defaultDrinkSize =
    confirmation.brewMode === "cold" ? 300 : confirmation.strength === "strong" ? 252 : 255;
  const [drinkMl, setDrinkMl] = useState(defaultDrinkSize);

  const selectedProfile = confirmation.suggestedProfile || "neutral_classic";
  const profileOption = confirmation.profileOptions?.find(
    (option) => option.id === selectedProfile,
  );
  const profileLabel = profileOption
    ? `${profileOption.emoji || "☕"} ${profileOption.labelEn || profileOption.id}`
    : selectedProfile;

  const canConfirm =
    storeName.trim().length > 0 &&
    beanName.trim().length > 0 &&
    (!needsOrigin || origin.trim().length > 0) &&
    (!needsProcessingMethod || processingMethod.trim().length > 0) &&
    (!needsDescription || description.trim().length > 0) &&
    roastLevel !== "unknown";

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!submittingRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [returnFocusRef]);

  function submitConfirmation() {
    if (!canConfirm || submitting) return;
    const details: ConfirmationRecipeDetails = {
      finalDrinkMl: drinkMl,
      roastLevel,
    };
    if (needsOrigin) details.origin = origin.trim();
    if (needsProcessingMethod) details.processingMethod = processingMethod.trim();
    if (needsDescription) details.description = description.trim();
    onConfirm(storeName.trim(), beanName.trim(), details);
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <dialog
        ref={dialogRef}
        open
        className="confirmation-dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
      >
        <div className="dialog-handle" aria-hidden="true" />
        <div className="dialog-heading">
          <div>
            <p className="section-kicker">Final review</p>
            <h2 id="confirmation-title">Confirm Below Details</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close confirmation"
            disabled={submitting}
            onClick={onCancel}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="dialog-content">
          <section className="review-group" aria-labelledby="identity-heading">
            <div className="review-group-heading">
              <span>01</span>
              <h3 id="identity-heading">Bean identity</h3>
            </div>
            <div className="field-grid">
              <label>
                Rostery/Café
                <input
                  value={storeName}
                  onChange={(event) =>
                    setStoreName(limitCharacters(event.target.value, STORE_NAME_MAX_CHARS))
                  }
                  maxLength={STORE_NAME_MAX_CHARS}
                  disabled={submitting}
                  placeholder="Max 40 characters"
                />
              </label>
              <label>
                Bean name
                <input
                  value={beanName}
                  onChange={(event) =>
                    setBeanName(limitCharacters(event.target.value, BEAN_NAME_MAX_CHARS))
                  }
                  maxLength={BEAN_NAME_MAX_CHARS}
                  disabled={submitting}
                  placeholder="Max 60 characters"
                />
              </label>
            </div>
          </section>

          <section className="review-group" aria-labelledby="details-heading">
            <div className="review-group-heading">
              <span>02</span>
              <h3 id="details-heading">Missing bean details</h3>
            </div>
            <div className="field-grid two-columns">
              {needsOrigin ? (
                <label>
                  Origin
                  <input
                    value={origin}
                    onChange={(event) => setOrigin(event.target.value.slice(0, 100))}
                    maxLength={100}
                    disabled={submitting}
                    placeholder="Example: Yemen / Ethiopia"
                  />
                </label>
              ) : null}

              {needsProcessingMethod ? (
                <label>
                  Processing method
                  <select
                    value={processingMethod}
                    onChange={(event) => setProcessingMethod(event.target.value)}
                    disabled={submitting}
                  >
                    <option value="">Select process</option>
                    {PROCESSING_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {needsDescription ? (
                <label className="field-wide">
                  Tasting notes / description
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value.slice(0, 200))}
                    maxLength={200}
                    rows={2}
                    disabled={submitting}
                    placeholder="Example: red fruits, chocolate, floral"
                  />
                </label>
              ) : null}

              <label className="field-wide">
                Roast level
                <select
                  aria-label="Roast level"
                  value={roastLevel}
                  onChange={(event) => setRoastLevel(event.target.value as RoastLevel)}
                  disabled={submitting}
                >
                  {ROAST_LEVELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {roastLevel === "unknown" ? (
                  <p role="alert">Select the roast level before creating the recipe.</p>
                ) : null}
              </label>

              <div className="preliminary-profile field-wide">
                <span>Brew profile</span>
                <strong>Preliminary guess: {profileLabel}</strong>
                <small>Final profile is chosen after you confirm the bean details.</small>
              </div>
            </div>
          </section>

          <section className="review-group" aria-labelledby="settings-heading">
            <div className="review-group-heading">
              <span>03</span>
              <h3 id="settings-heading">Brew settings</h3>
            </div>
            <div className="confirmed-choice-row">
              <span>
                <small>Temperature</small>
                <strong>{confirmation.brewMode === "cold" ? "Cold" : "Hot"}</strong>
              </span>
              <span>
                <small>Strength</small>
                <strong>{confirmation.strength === "strong" ? "Strong" : "Soft"}</strong>
              </span>
            </div>
            <fieldset className="drink-size-fieldset" disabled={submitting}>
              <legend className="sr-only">Drink size</legend>
              <div>
                {drinkSizes.map((size) => (
                  <label key={size} className={drinkMl === size ? "selected" : ""}>
                    <input
                      className="sr-only"
                      type="radio"
                      name="drink-size"
                      value={size}
                      checked={drinkMl === size}
                      onChange={() => setDrinkMl(size)}
                    />
                    <span>{size}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          {error ? (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-action"
            disabled={!canConfirm || submitting}
            onClick={submitConfirmation}
          >
            <span>{submitting ? "Creating recipe…" : "Confirm and create recipe"}</span>
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </div>
  );
}
