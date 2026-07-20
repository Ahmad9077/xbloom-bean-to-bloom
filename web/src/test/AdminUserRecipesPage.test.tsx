import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUserRecipePage from "../pages/AdminUserRecipePage.js";
import AdminUserRecipesPage from "../pages/AdminUserRecipesPage.js";
import type { Recipe } from "../types.js";

vi.mock("../api.js", () => ({
  apiGetAdminUserRecipes: vi.fn(),
  apiGetAdminUserRecipe: vi.fn(),
}));

vi.mock("../components/RecipeResult.js", () => ({
  default: ({
    recipe,
    readOnly,
    backLabel,
  }: {
    recipe: Recipe;
    readOnly?: boolean;
    backLabel?: string;
  }) => (
    <div>
      <h1>{recipe.name}</h1>
      <span>{readOnly ? "Read only" : "Editable"}</span>
      <span>{backLabel}</span>
    </div>
  ),
}));

import { apiGetAdminUserRecipe, apiGetAdminUserRecipes } from "../api.js";

const mockGetRecipes = vi.mocked(apiGetAdminUserRecipes);
const mockGetRecipe = vi.mocked(apiGetAdminUserRecipe);

const RECIPE: Recipe = {
  name: "alice — Cold/Umq/Haraz",
  machine: "xBloom Studio",
  dripper: "Other",
  brewMode: "cold",
  strength: "strong",
  brewRatio: "1:9",
  totalVolumeMl: 180,
  doseG: 20,
  grindSize: 38,
  rpm: 80,
  pours: [],
  bean: {
    coffeeType: "Arabica",
    variety: "Yemenia",
    origin: "Yemen",
    processingMethod: "natural",
    roastLevel: "medium_light",
    flavors: ["Red fruit"],
    description: "",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Admin user recipe history", () => {
  it("loads the selected user's real recipes and opens the read-only route", async () => {
    mockGetRecipes.mockResolvedValue({
      user: { id: "u1", username: "alice" },
      recipes: [
        {
          id: "r1",
          fullName: RECIPE.name,
          storeName: "Umq",
          beanName: "Haraz",
          createdAt: Date.parse("2026-07-20T10:00:00Z"),
          link: "/admin/users/u1/recipes/r1",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/admin/users/u1/recipes"]}>
        <Routes>
          <Route path="/admin/users/:userId/recipes" element={<AdminUserRecipesPage />} />
          <Route path="/admin/users/:userId/recipes/:recipeId" element={<p>Recipe opened</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: /alice's recipe history/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open recipe/i }));
    expect(await screen.findByText("Recipe opened")).toBeInTheDocument();
  });
});

describe("Admin user recipe detail", () => {
  it("renders through RecipeResult in read-only mode", async () => {
    mockGetRecipe.mockResolvedValue({
      user: { id: "u1", username: "alice" },
      recipe: RECIPE,
    });

    render(
      <MemoryRouter initialEntries={["/admin/users/u1/recipes/r1"]}>
        <Routes>
          <Route path="/admin/users/:userId/recipes/:recipeId" element={<AdminUserRecipePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: RECIPE.name })).toBeInTheDocument();
    });
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByText("Back to User Recipes")).toBeInTheDocument();
  });
});
