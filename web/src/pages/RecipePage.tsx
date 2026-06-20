import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, apiGetRecipe } from "../api.js";
import RecipeResult from "../components/RecipeResult.js";
import type { Recipe } from "../types.js";

export default function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recipeId = id ?? "";

  useEffect(() => {
    if (!recipeId) {
      navigate("/", { replace: true });
      return;
    }
    apiGetRecipe(recipeId)
      .then((r) => {
        setRecipe(r);
        document.title = `${r.name} — Bean to Bloom`;
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            navigate("/login", { replace: true });
          } else if (err.status === 404) {
            setError("Recipe not found.");
          } else {
            setError(err.message);
          }
        } else {
          setError("Failed to load recipe.");
        }
      });

    return () => {
      document.title = "Bean to Bloom";
    };
  }, [recipeId, navigate]);

  if (error) {
    return (
      <main className="min-h-screen bg-ivory flex flex-col items-center justify-center px-4">
        <div
          role="alert"
          className="w-full max-w-md bg-red-50 border border-red-200 rounded-card p-6 text-center"
        >
          <p className="font-semibold text-red-800 mb-2">Could not load recipe</p>
          <p className="text-sm text-red-700 mb-4">{error}</p>
          <a
            href="/"
            className="inline-block font-body text-xs font-semibold uppercase tracking-widest
                       text-espresso underline hover:no-underline"
          >
            Back to home
          </a>
        </div>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main className="min-h-screen bg-ivory flex items-center justify-center">
        <div
          className="w-10 h-10 rounded-full border-4 border-sage border-t-terracotta animate-spin"
          role="status"
          aria-label="Loading recipe"
        />
      </main>
    );
  }

  return <RecipeResult recipe={recipe} recipeId={recipeId} />;
}
