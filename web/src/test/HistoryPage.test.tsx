import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import HistoryPage from "../pages/HistoryPage.js";
import type { RecipeListItem } from "../types.js";

vi.mock("../api.js", () => ({
  apiGetRecipes: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

import { apiGetRecipes } from "../api.js";
const mockGetRecipes = vi.mocked(apiGetRecipes);

const mockAuthValue = {
  user: { id: "1", username: "tester", role: "user" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const RECIPES: RecipeListItem[] = [
  {
    id: "r1",
    fullName: "Ethiopia Light Roast",
    beanName: "Ethiopia",
    createdAt: Date.parse("2024-01-15T10:30:00Z"),
    link: "https://x.com/recipes/r1",
  },
  {
    id: "r2",
    fullName: "Colombia Medium Roast",
    beanName: "Colombia",
    createdAt: Date.parse("2024-01-16T14:00:00Z"),
    link: "https://x.com/recipes/r2",
  },
];

function renderPage() {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HistoryPage — loading state", () => {
  it("shows loading spinner while fetching", () => {
    mockGetRecipes.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status", { name: /loading recipes/i })).toBeInTheDocument();
  });
});

describe("HistoryPage — empty state", () => {
  it("shows empty message when no recipes", async () => {
    mockGetRecipes.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no recipes yet/i)).toBeInTheDocument();
    });
  });

  it("shows control to create a recipe", async () => {
    mockGetRecipes.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create your first recipe/i })).toBeInTheDocument();
    });
  });
});

describe("HistoryPage — recipe list", () => {
  it("displays recipe names", async () => {
    mockGetRecipes.mockResolvedValue(RECIPES);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Ethiopia Light Roast")).toBeInTheDocument();
      expect(screen.getByText("Colombia Medium Roast")).toBeInTheDocument();
    });
  });

  it("shows Open recipe controls", async () => {
    mockGetRecipes.mockResolvedValue(RECIPES);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /open recipe/i })).toHaveLength(2);
    });
  });

  it("does not show recipe URLs or copy-link controls", async () => {
    mockGetRecipes.mockResolvedValue(RECIPES);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Ethiopia Light Roast")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\/recipes\/r1/i)).not.toBeInTheDocument();
  });

  it("shows local date/time for each recipe", async () => {
    mockGetRecipes.mockResolvedValue(RECIPES);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Ethiopia Light Roast")).toBeInTheDocument();
    });
    // Date should be formatted (Jan 15, 2024 or similar)
    expect(screen.getAllByText(/jan/i)).toHaveLength(2);
  });
});

describe("HistoryPage — error state", () => {
  it("shows error when API fails", async () => {
    mockGetRecipes.mockRejectedValue(new Error("Network error"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
