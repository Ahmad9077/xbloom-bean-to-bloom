import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGetAdminUserRecipe } from "../api.js";
import RecipeResult from "../components/RecipeResult.js";
import type { Recipe } from "../types.js";

export default function AdminUserRecipePage() {
  const navigate = useNavigate();
  const { userId = "", recipeId = "" } = useParams();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backHref = `/admin/users/${encodeURIComponent(userId)}/recipes`;

  useEffect(() => {
    if (!userId || !recipeId) {
      setError("Recipe not found.");
      return;
    }

    void apiGetAdminUserRecipe(userId, recipeId)
      .then((response) => {
        setRecipe(response.recipe);
        document.title = `${response.recipe.name} — Bean to Bloom`;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load recipe.");
      });

    return () => {
      document.title = "Bean to Bloom";
    };
  }, [recipeId, userId]);

  if (error) {
    return (
      <main className="collection-page">
        <header className="page-heading">
          <div>
            <p className="section-kicker">Read-only recipe</p>
            <h1>Could not load recipe</h1>
            <p>{error}</p>
          </div>
        </header>
        <button type="button" className="secondary-action" onClick={() => navigate(backHref)}>
          Back to User Recipes
        </button>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main className="collection-page flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading recipe"
        />
      </main>
    );
  }

  return (
    <RecipeResult
      recipe={recipe}
      recipeId={recipeId}
      readOnly
      backHref={backHref}
      backLabel="Back to User Recipes"
    />
  );
}
