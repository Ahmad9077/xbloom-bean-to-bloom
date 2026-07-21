import { useState } from "react";
import type { Recipe } from "../types.js";
import CloudBridge from "./CloudBridge.js";
import PourTimeline from "./PourTimeline.js";

const ROAST_LABEL: Record<string, string> = {
  light: "Light",
  medium_light: "Medium-light",
  medium: "Medium",
  medium_dark: "Medium-dark",
  dark: "Dark",
  unknown: "Unknown",
};

const PROFILE_LABEL: Record<string, { emoji: string; label: string }> = {
  bright_clean: { emoji: "☀️", label: "Bright & fruity" },
  bright_funky: { emoji: "🍓", label: "Funky natural" },
  neutral_classic: { emoji: "⚖️", label: "Classic balanced" },
  dark_roasty: { emoji: "🍫", label: "Dark & roasty" },
};

interface Props {
  recipe: Recipe;
  recipeId: string;
  readOnly?: boolean;
  backHref?: string;
  backLabel?: string;
}

export default function RecipeResult({
  recipe,
  recipeId,
  readOnly = false,
  backHref = "/",
  backLabel = "Back for a New Recipe",
}: Props) {
  const isIced = recipe.brewMode === "cold";
  const [isCached] = useState(() => {
    try {
      const cached = sessionStorage.getItem("xbloom:cachedRecipe") === recipeId;
      if (cached) sessionStorage.removeItem("xbloom:cachedRecipe");
      return cached;
    } catch {
      return false;
    }
  });

  const profile = recipe.profile
    ? (PROFILE_LABEL[recipe.profile] ?? { emoji: "☕", label: recipe.profile })
    : null;

  return (
    <main className="recipe-page">
      <section className="recipe-hero">
        <div className="recipe-hero-inner">
          <div>
            <div className="recipe-tags">
              <span>V60</span>
              <span>{isIced ? "Cold" : "Hot"}</span>
              <span>{recipe.strength === "strong" ? "Strong" : "Soft"}</span>
              <small>{recipe.machine}</small>
              {isCached && (
                <em className="cached-recipe-badge">Saved recipe — same bean as before</em>
              )}
            </div>
            <p className="section-kicker light">Ready to brew</p>
            <h1>{formatRecipeTitle(recipe.name)}</h1>
            {recipe.bean.origin && <p className="recipe-origin">{recipe.bean.origin}</p>}
            {profile && (
              <div className="profile-line">
                <span>{profile.emoji}</span> {profile.label}
              </div>
            )}
          </div>

          {recipe.tasteRationale && (
            <div className="rationale-card">
              <span>Why this brew</span>
              <p>{recipe.tasteRationale}</p>
            </div>
          )}
        </div>
      </section>

      <div className="recipe-layout">
        <div className="recipe-main-column">
          <section className="content-section recipe-passport" aria-labelledby="params-heading">
            <div className="content-heading">
              <p className="section-kicker">Recipe passport</p>
              <h2 id="params-heading">Machine Recipe</h2>
            </div>
            <div className="metrics-grid">
              <Metric label="Dose" value={String(recipe.doseG)} unit="g" />
              <Metric label="Machine water" value={String(recipe.totalVolumeMl)} unit="ml" />
              <Metric label="Ratio" value={recipe.brewRatio} />
              <Metric label="Grind" value={String(recipe.grindSize)} />
              <Metric label="RPM" value={String(recipe.rpm)} />
              <Metric label="Dripper" value={recipe.dripper} />
            </div>
          </section>

          {isIced && recipe.icedServing && (
            <section className="ice-card" aria-labelledby="ice-heading" aria-label="Iced Serving">
              <div className="ice-visual">
                <span>{recipe.icedServing.iceG}</span>
                <small>g ice</small>
              </div>
              <div>
                <p className="section-kicker">Before brewing</p>
                <h2 id="ice-heading">Ice Required Before Brewing</h2>
                <p>
                  Put exactly <strong>{recipe.icedServing.iceG} g of ice</strong> in your serving
                  glass or carafe. xBloom brews {recipe.totalVolumeMl} ml over it, making about{" "}
                  {recipe.icedServing.totalBeverageMl} ml total.
                </p>
                <small>Ice is measured separately and is not entered in the xBloom app.</small>
              </div>
            </section>
          )}

          <section className="content-section pour-section" aria-labelledby="pours-heading">
            <div className="content-heading">
              <p className="section-kicker">{stageLabel(recipe.pours.length)}</p>
              <h2 id="pours-heading">Pour Timeline</h2>
            </div>
            <PourTimeline pours={recipe.pours} />
          </section>
        </div>

        <aside className="recipe-side-column">
          <BeanDetails recipe={recipe} />

          {!readOnly && <CloudBridge recipeId={recipeId} />}

          <a className="secondary-action full-width recipe-back-action" href={backHref}>
            <span aria-hidden="true">←</span>
            <strong>{backLabel}</strong>
          </a>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {unit ? <small>{unit}</small> : null}
    </div>
  );
}

function BeanDetails({ recipe }: { recipe: Recipe }) {
  const details = [
    { label: "Rostery/Café", value: recipe.bean.storeName },
    { label: "Bean name", value: recipe.bean.beanName },
    { label: "Type", value: recipe.bean.coffeeType },
    { label: "Variety", value: recipe.bean.variety },
    { label: "Origin", value: recipe.bean.origin },
    { label: "Process", value: recipe.bean.processingMethod },
    {
      label: "Roast",
      value: ROAST_LABEL[recipe.bean.roastLevel] ?? recipe.bean.roastLevel,
    },
  ].filter((detail): detail is { label: string; value: string } => Boolean(detail.value));

  return (
    <section className="content-section bean-details" aria-labelledby="bean-details-heading">
      <div className="content-heading">
        <p className="section-kicker">From the bag</p>
        <h2 id="bean-details-heading">Bean Details</h2>
      </div>
      <dl>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      {recipe.bean.flavors.length > 0 && (
        <div className="flavor-tags">
          {recipe.bean.flavors.map((flavor) => (
            <span key={flavor}>{flavor}</span>
          ))}
        </div>
      )}
      {recipe.bean.description && <p className="bean-description">{recipe.bean.description}</p>}
    </section>
  );
}

function formatRecipeTitle(name: string) {
  const firstSlash = name.indexOf("/");
  if (firstSlash < 0 || firstSlash === name.length - 1) return name;

  return (
    <>
      {name.slice(0, firstSlash + 1)}
      <br />
      {name.slice(firstSlash + 1)}
    </>
  );
}

function stageLabel(count: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five"];
  const countLabel = words[count] ?? String(count);
  return `${countLabel} ${count === 1 ? "stage" : "stages"}`;
}
