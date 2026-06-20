import { useState } from "react";
import type { Recipe } from "../types.js";
import CloudBridge from "./CloudBridge.js";
import PourTimeline from "./PourTimeline.js";
import StepProgress from "./StepProgress.js";

const ROAST_LABEL: Record<string, string> = {
  light: "Light Roast",
  medium: "Medium Roast",
  dark: "Dark Roast",
};

const RESULT_STEPS = [
  { label: "Photo", status: "complete" as const },
  { label: "Recipe", status: "active" as const },
  { label: "xBloom", status: "next" as const },
];

interface Props {
  recipe: Recipe;
  recipeId: string;
  link: string;
}

export default function RecipeResult({ recipe, recipeId, link }: Props) {
  const [copied, setCopied] = useState(false);
  const isIced = recipe.brewMode === "cold";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement("input");
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <main className="min-h-screen bg-ivory">
      {/* Hero header */}
      <header className="bg-espresso text-ivory px-6 pt-8 pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <StepProgress steps={RESULT_STEPS} />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full ${
                isIced ? "bg-sage/30 text-sage" : "bg-terracotta/30 text-terracotta"
              }`}
            >
              {isIced ? "Iced Pour-Over" : "Hot Pour-Over"}
            </span>
            <span className="text-xs text-ivory/50">{recipe.machine}</span>
          </div>
          <h1 className="font-heading text-3xl md:text-4xl mb-1">{recipe.name}</h1>
          {recipe.bean.origin && <p className="text-ivory/70 text-sm">{recipe.bean.origin}</p>}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Iced serving note */}
        {isIced && recipe.icedServing && (
          <section
            aria-labelledby="iced-heading"
            aria-label="Iced Serving"
            className="bg-sage/10 border border-sage/30 rounded-card p-4"
          >
            <h2
              id="iced-heading"
              className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-2"
            >
              Iced Serving
            </h2>
            <p className="text-sm text-espresso">
              Serve over <strong>{recipe.icedServing.iceG} g ice</strong> outside the xBloom
              machine. The machine brews {recipe.totalVolumeMl} ml of hot coffee; the ice is{" "}
              <strong>added by you after brewing</strong>. Total beverage:{" "}
              <strong>{recipe.icedServing.totalBeverageMl} ml</strong> (overall 1:
              {Math.round(recipe.icedServing.totalBeverageMl / recipe.doseG)} ratio).
            </p>
            <p className="text-xs text-sage mt-2">
              The xBloom machine has no cold setting — it always brews hot water.
            </p>
          </section>
        )}

        {/* Stable link */}
        <section aria-labelledby="link-heading">
          <h2
            id="link-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Recipe Link
          </h2>
          <div className="bg-white rounded-card p-4 flex items-center gap-3">
            <span
              className="text-sm text-espresso/70 flex-1 truncate font-body"
              title={link}
              aria-label="Recipe URL"
            >
              {link}
            </span>
            <button
              type="button"
              onClick={copyLink}
              aria-label={copied ? "Link copied" : "Copy link to clipboard"}
              className="flex-shrink-0 min-h-touch px-4 py-2 bg-espresso text-ivory text-xs
                         font-semibold font-body rounded-[12px] transition-opacity hover:opacity-80
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
            >
              {copied ? "Link copied" : "Copy Link"}
            </button>
          </div>
        </section>

        {/* Bean details */}
        <section aria-labelledby="bean-heading">
          <h2
            id="bean-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Bean Details
          </h2>
          <div className="bg-white rounded-card p-4 space-y-2">
            {recipe.bean.coffeeType && <Detail label="Type" value={recipe.bean.coffeeType} />}
            {recipe.bean.variety && <Detail label="Variety" value={recipe.bean.variety} />}
            {recipe.bean.origin && <Detail label="Origin" value={recipe.bean.origin} />}
            {recipe.bean.processingMethod && (
              <Detail label="Process" value={recipe.bean.processingMethod} />
            )}
            <Detail
              label="Roast"
              value={ROAST_LABEL[recipe.bean.roastLevel] ?? recipe.bean.roastLevel}
            />
            {recipe.bean.flavors.length > 0 && (
              <div className="flex gap-1 flex-wrap pt-1">
                {recipe.bean.flavors.map((f) => (
                  <span
                    key={f}
                    className="text-xs bg-terracotta/10 text-terracotta px-2 py-0.5 rounded-full"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            {recipe.bean.description && (
              <p className="text-xs text-espresso/60 pt-1 italic">{recipe.bean.description}</p>
            )}
          </div>
        </section>

        {/* Machine parameters */}
        <section aria-labelledby="params-heading">
          <h2
            id="params-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Machine Recipe
          </h2>
          <div className="bg-white rounded-card p-4 grid grid-cols-2 gap-3">
            <Detail label="Dose" value={`${recipe.doseG} g`} />
            <Detail label="Machine water" value={`${recipe.totalVolumeMl} ml`} />
            <Detail label="Ratio" value={recipe.brewRatio} />
            <Detail label="Grind" value={String(recipe.grindSize)} />
            <Detail label="RPM" value={String(recipe.rpm)} />
            <Detail label="Dripper" value={recipe.dripper} />
          </div>
        </section>

        {/* Pour timeline */}
        <section aria-labelledby="pours-heading">
          <h2
            id="pours-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Pour Timeline
          </h2>
          <PourTimeline pours={recipe.pours} />
        </section>

        {/* Cloud bridge */}
        <section aria-labelledby="bridge-heading">
          <h2
            id="bridge-heading"
            className="font-body text-xs font-semibold uppercase tracking-widest text-sage mb-3"
          >
            Send to xBloom Studio
          </h2>
          <CloudBridge recipeId={recipeId} />
        </section>

        <div className="pt-2 pb-8">
          <a
            href="/"
            className="block w-full min-h-touch border border-espresso/30 text-espresso font-body
                       font-semibold rounded-card py-4 transition-colors hover:bg-espresso/5
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta
                       text-center"
          >
            New Recipe
          </a>
        </div>
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-espresso/50">{label}</dt>
      <dd className="text-sm font-semibold text-espresso">{value}</dd>
    </div>
  );
}
