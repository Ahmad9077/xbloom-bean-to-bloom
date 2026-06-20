import { useEffect, useState } from "react";
import { apiGetRecipes } from "../api.js";
import type { RecipeListItem } from "../types.js";

function formatLocalDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "Unknown";
  }
}

function recipeUrl(id: string): string {
  return `${window.location.origin}/recipes/${encodeURIComponent(id)}`;
}

export default function HistoryPage() {
  const [recipes, setRecipes] = useState<RecipeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    apiGetRecipes()
      .then(setRecipes)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load recipes.");
      });
  }, []);

  async function copyLink(id: string) {
    const url = recipeUrl(id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("input");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  if (error) {
    return (
      <main className="min-h-screen bg-ivory px-4 py-8 max-w-2xl mx-auto">
        <h1 className="font-heading text-3xl text-espresso mb-6">Recipe History</h1>
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-700"
        >
          {error}
        </div>
      </main>
    );
  }

  if (recipes === null) {
    return (
      <main className="min-h-screen bg-ivory flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading recipes"
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ivory px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="font-heading text-3xl text-espresso mb-6">Recipe History</h1>

        {recipes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sage font-body text-sm">No recipes yet.</p>
            <a
              href="/"
              className="mt-4 inline-block font-body text-xs font-semibold uppercase tracking-widest
                         text-espresso underline hover:no-underline"
            >
              Create your first recipe
            </a>
          </div>
        ) : (
          <ol className="space-y-4" aria-label="Your recipes">
            {recipes.map((r) => {
              const url = recipeUrl(r.id);
              return (
                <li
                  key={r.id}
                  className="bg-white rounded-card p-4 space-y-3 border border-espresso/5"
                >
                  <div>
                    <p className="font-heading text-lg text-espresso">{r.fullName}</p>
                    <p className="text-xs text-espresso/50 font-body mt-0.5">
                      {formatLocalDate(r.createdAt)}
                    </p>
                  </div>

                  <p
                    className="text-xs text-espresso/40 font-body truncate"
                    title={url}
                    aria-label="Recipe URL"
                  >
                    {url}
                  </p>

                  <div className="flex gap-2">
                    <a
                      href={`/recipes/${encodeURIComponent(r.id)}`}
                      className="flex-1 min-h-touch bg-espresso text-ivory font-body font-semibold
                                 text-xs rounded-[12px] flex items-center justify-center
                                 hover:opacity-90 transition-opacity focus-visible:outline-2
                                 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                    >
                      Open recipe
                    </a>
                    <button
                      type="button"
                      onClick={() => copyLink(r.id)}
                      aria-label={copiedId === r.id ? "Link copied" : `Copy link for ${r.fullName}`}
                      className="min-h-touch px-4 border border-espresso/20 text-espresso font-body
                                 font-semibold text-xs rounded-[12px] hover:bg-espresso/5 transition-colors
                                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                    >
                      {copiedId === r.id ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}
