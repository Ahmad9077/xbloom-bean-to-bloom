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

export default function HistoryPage() {
  const [recipes, setRecipes] = useState<RecipeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGetRecipes()
      .then(setRecipes)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load recipes.");
      });
  }, []);

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

                  <div>
                    <a
                      href={`/recipes/${encodeURIComponent(r.id)}`}
                      className="flex min-h-touch w-full bg-espresso text-ivory font-body font-semibold
                                 text-xs rounded-[12px] flex items-center justify-center
                                 hover:opacity-90 transition-opacity focus-visible:outline-2
                                 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                    >
                      Open recipe
                    </a>
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
