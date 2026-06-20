import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import RecipePage from "../pages/RecipePage.js";
import type { Recipe } from "../types.js";

vi.mock("../api.js", () => ({
  apiGetRecipe: vi.fn(),
  apiCreateBridgeJob: vi.fn(),
  apiGetBridgeJob: vi.fn(),
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

import { ApiError, apiCreateBridgeJob, apiGetBridgeJob, apiGetRecipe } from "../api.js";
const mockGetRecipe = vi.mocked(apiGetRecipe);

const mockAuthValue = {
  user: { id: "1", username: "tester", role: "user" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const RECIPE: Recipe = {
  name: "Ethiopia Light Roast",
  machine: "xBloom Studio",
  dripper: "Omni",
  brewMode: "hot",
  brewRatio: "1:14",
  totalVolumeMl: 224,
  doseG: 16,
  grindSize: 19,
  rpm: 100,
  pours: [
    {
      label: "Bloom",
      volumeMl: 49,
      tempC: 92,
      flowRateMlPerSec: 3.0,
      pauseSec: 40,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
  ],
  bean: {
    coffeeType: "Single Origin",
    variety: "Heirloom",
    origin: "Ethiopia",
    processingMethod: "Washed",
    roastLevel: "light",
    flavors: ["blueberry"],
    description: "Bright.",
  },
};

function renderPage(id = "abc123") {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <MemoryRouter initialEntries={[`/recipes/${id}`]}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipePage />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiCreateBridgeJob).mockResolvedValue({
    id: "j1",
    recipeId: "abc123",
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
    safeError: null,
  });
  vi.mocked(apiGetBridgeJob).mockResolvedValue({
    id: "j1",
    recipeId: "abc123",
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
    safeError: null,
  });
});

describe("RecipePage — loading", () => {
  it("shows loading spinner while fetching", () => {
    mockGetRecipe.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status", { name: /loading recipe/i })).toBeInTheDocument();
  });
});

describe("RecipePage — recipe display", () => {
  it("shows recipe name after loading", async () => {
    mockGetRecipe.mockResolvedValue(RECIPE);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ethiopia Light Roast");
    });
  });

  it("shows stable current-origin URL", async () => {
    mockGetRecipe.mockResolvedValue(RECIPE);
    renderPage("abc123");
    await waitFor(() => {
      expect(screen.getByLabelText(/recipe url/i)).toHaveTextContent(/recipes\/abc123/);
    });
  });

  it("shows Copy Link button", async () => {
    mockGetRecipe.mockResolvedValue(RECIPE);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    });
  });

  it("copies link to clipboard", async () => {
    mockGetRecipe.mockResolvedValue(RECIPE);
    renderPage("abc123");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/recipes/abc123"),
      );
    });
  });

  it("sets document title to recipe name", async () => {
    mockGetRecipe.mockResolvedValue(RECIPE);
    renderPage();
    await waitFor(() => {
      expect(document.title).toContain("Ethiopia Light Roast");
    });
  });
});

describe("RecipePage — errors", () => {
  it("shows error message when recipe not found", async () => {
    mockGetRecipe.mockRejectedValue(new ApiError("Not found", "NOT_FOUND", 404));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/recipe not found/i);
    });
  });

  it("redirects to /login on 401", async () => {
    mockGetRecipe.mockRejectedValue(new ApiError("Unauthorized", "UNAUTHORIZED", 401));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
  });
});
