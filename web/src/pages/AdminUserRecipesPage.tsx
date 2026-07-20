import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGetAdminUserRecipes } from "../api.js";
import StudioIcon from "../components/StudioIcon.js";
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

function recipeMode(recipe: RecipeListItem): "Cold" | "Hot" | null {
  const match = recipe.fullName.match(/[—-]\s*(Cold|Hot)\//i);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() === "cold" ? "Cold" : "Hot";
}

export default function AdminUserRecipesPage() {
  const navigate = useNavigate();
  const { userId = "" } = useParams();
  const [username, setUsername] = useState("");
  const [recipes, setRecipes] = useState<RecipeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setError("User not found.");
      return;
    }

    void apiGetAdminUserRecipes(userId)
      .then((response) => {
        setUsername(response.user.username);
        setRecipes(response.recipes);
        document.title = `${response.user.username}'s Recipes — Bean to Bloom`;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load recipes.");
      });

    return () => {
      document.title = "Bean to Bloom";
    };
  }, [userId]);

  if (error) {
    return (
      <main className="collection-page">
        <header className="page-heading">
          <div>
            <p className="section-kicker">Recipe activity</p>
            <h1>User Recipe History</h1>
            <p>Review recipes created by this Bean to Bloom account.</p>
          </div>
        </header>
        <div role="alert" className="content-section bg-red-50 border-red-200 text-red-700">
          {error}
        </div>
        <button type="button" className="secondary-action mt-5" onClick={() => navigate("/admin")}>
          Back to Admin Dashboard
        </button>
      </main>
    );
  }

  if (recipes === null) {
    return (
      <main className="collection-page flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading user recipes"
        />
      </main>
    );
  }

  return (
    <main className="collection-page">
      <header className="page-heading">
        <div>
          <p className="section-kicker">Recipe activity</p>
          <h1>{username}&apos;s Recipe History</h1>
          <p>Review recipes created by this Bean to Bloom account.</p>
        </div>
        <span className="count-badge">
          {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
        </span>
      </header>

      <button type="button" className="secondary-action mb-6" onClick={() => navigate("/admin")}>
        Back to Admin Dashboard
      </button>

      {recipes.length === 0 ? (
        <section className="content-section text-center py-16">
          <p className="text-sage font-body text-sm">No recipes yet.</p>
        </section>
      ) : (
        <ol className="history-grid" aria-label={`Recipes for ${username}`}>
          {recipes.map((recipe, index) => {
            const mode = recipeMode(recipe);
            return (
              <li className="history-card" key={recipe.id}>
                <div className={`history-art art-${(index % 3) + 1}`} aria-hidden="true">
                  <span />
                  <span />
                  <i />
                </div>
                <div className="history-card-body">
                  <div className="history-tags">
                    {mode ? <span>{mode}</span> : null}
                    <small>V60</small>
                  </div>
                  <h2>{recipe.fullName}</h2>
                  <p>{recipe.storeName || recipe.beanName}</p>
                  <time dateTime={new Date(recipe.createdAt).toISOString()}>
                    {formatLocalDate(recipe.createdAt)}
                  </time>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/admin/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipe.id)}`,
                      )
                    }
                  >
                    Open recipe <StudioIcon name="arrow" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
