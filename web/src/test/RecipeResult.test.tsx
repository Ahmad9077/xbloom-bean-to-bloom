import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecipeResult from "../components/RecipeResult.js";
import type { Recipe } from "../types.js";

vi.mock("../api.js", () => ({
  apiCreateBridgeJob: vi.fn().mockResolvedValue({ id: "j1", status: "pending" }),
  apiGetBridgeJob: vi.fn().mockResolvedValue({ id: "j1", status: "pending" }),
  apiRateRecipe: vi.fn(),
  apiRetuneRecipe: vi.fn(),
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

import { ApiError, apiRateRecipe, apiRetuneRecipe } from "../api.js";

const mockRateRecipe = vi.mocked(apiRateRecipe);
const mockRetuneRecipe = vi.mocked(apiRetuneRecipe);

const BASE_BEAN = {
  storeName: "Sample Roaster",
  beanName: "Yirgacheffe",
  coffeeType: "Single Origin",
  variety: "Heirloom",
  origin: "Ethiopia",
  processingMethod: "Washed",
  roastLevel: "light" as const,
  flavors: ["blueberry", "jasmine"],
  description: "Bright Ethiopian.",
};

const COLD_RECIPE: Recipe = {
  name: "Ethiopia Iced Light Roast",
  machine: "xBloom Studio",
  dripper: "Omni",
  brewMode: "cold",
  strength: "strong",
  brewRatio: "1:10",
  totalVolumeMl: 160,
  doseG: 16,
  grindSize: 19,
  rpm: 100,
  pours: [
    {
      label: "Bloom",
      volumeMl: 35,
      tempC: 92,
      flowRateMlPerSec: 3.0,
      pauseSec: 40,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 2",
      volumeMl: 75,
      tempC: 93,
      flowRateMlPerSec: 3.0,
      pauseSec: 20,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 3",
      volumeMl: 50,
      tempC: 94,
      flowRateMlPerSec: 3.0,
      pauseSec: 10,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
  ],
  bean: BASE_BEAN,
  profile: "bright_clean",
  engine: "hybrid",
  tasteRationale: "A fine grind and high first pour highlight the washed bean's floral sweetness.",
  icedServing: {
    iceG: 140,
    totalBeverageMl: 300,
    instruction: "Serve over 140 g ice.",
  },
};

const HOT_RECIPE: Recipe = {
  name: "Ethiopia Light Roast",
  machine: "xBloom Studio",
  dripper: "Omni",
  brewMode: "hot",
  strength: "strong",
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
    {
      label: "Pour 2",
      volumeMl: 105,
      tempC: 93,
      flowRateMlPerSec: 3.0,
      pauseSec: 20,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 3",
      volumeMl: 70,
      tempC: 94,
      flowRateMlPerSec: 3.0,
      pauseSec: 10,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
  ],
  bean: BASE_BEAN,
  profile: "bright_clean",
  engine: "hybrid",
  tasteRationale: "A fine grind and high first pour highlight the washed bean's floral sweetness.",
};

const RECIPE_ID = "abc123";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockRateRecipe.mockImplementation(async (_recipeId, value, complaint) => ({
    rating: value === 0 ? null : value,
    complaint: value === -1 ? (complaint ?? null) : null,
  }));
  mockRetuneRecipe.mockRejectedValue(new ApiError("Could not re-tune this recipe.", "FAILED", 500));
  // Provide clipboard mock
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("RecipeResult — cold recipe", () => {
  it("shows the stored strength", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("renders the recipe name", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ethiopia Iced Light Roast",
    );
  });

  it("shows the approved V60 and Cold tags", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("V60")).toBeInTheDocument();
    expect(screen.getByText("Cold")).toBeInTheDocument();
  });

  it("displays the iced serving section with ice amount", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByRole("region", { name: /ice required/i })).toBeInTheDocument();
    expect(screen.getAllByText(/140 g/i).length).toBeGreaterThan(0);
  });

  it("states ice is measured outside the xBloom app", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/not entered in the xbloom app/i)).toBeInTheDocument();
  });

  it("shows total beverage 300 ml", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getAllByText(/300 ml/i).length).toBeGreaterThan(0);
  });

  it("shows machine water volume 160 ml", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getAllByText(/160 ml/i).length).toBeGreaterThan(0);
  });

  it("renders the pour timeline with all pours", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("Bloom")).toBeInTheDocument();
    expect(screen.getByText("Pour 2")).toBeInTheDocument();
    expect(screen.getByText("Pour 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pour Timeline" }).closest("section")).toHaveClass(
      "pour-section",
    );
  });
});

describe("RecipeResult — hot recipe", () => {
  it("shows the approved V60 and Hot tags", () => {
    render(<RecipeResult recipe={HOT_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("V60")).toBeInTheDocument();
    expect(screen.getByText("Hot")).toBeInTheDocument();
  });

  it("does not show the iced serving section", () => {
    render(<RecipeResult recipe={HOT_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.queryByRole("region", { name: /iced serving/i })).not.toBeInTheDocument();
  });

  it("does not mention 140 g ice", () => {
    render(<RecipeResult recipe={HOT_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.queryByText(/140 g ice/i)).not.toBeInTheDocument();
  });
});

describe("RecipeResult — current recipe link", () => {
  it("does not show the website recipe URL", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.queryByLabelText(/recipe url/i)).not.toBeInTheDocument();
  });

  it("offers a clear return to create another recipe", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByRole("link", { name: /back for a new recipe/i })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("RecipeResult — bean details", () => {
  it("shows bean origin", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getAllByText(/ethiopia/i).length).toBeGreaterThan(0);
  });

  it("shows flavors as tags", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("blueberry")).toBeInTheDocument();
    expect(screen.getByText("jasmine")).toBeInTheDocument();
  });

  it("shows grind and RPM", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("19")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});

describe("RecipeResult — adaptive recipe metadata", () => {
  it("shows the stored profile and taste rationale", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/bright & fruity/i)).toBeInTheDocument();
    expect(screen.getByText(/fine grind and high first pour/i)).toBeInTheDocument();
  });

  it("shows roastery and bean names from the stored bean metadata", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText("Sample Roaster")).toBeInTheDocument();
    expect(screen.getByText("Yirgacheffe")).toBeInTheDocument();
  });

  it("shows and consumes the cached-recipe session hint", () => {
    sessionStorage.setItem("xbloom:cachedRecipe", RECIPE_ID);
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/saved recipe — same bean as before/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("xbloom:cachedRecipe")).toBeNull();
  });
});

describe("RecipeResult — taste feedback", () => {
  it("opens the complaint choices before saving a Needs work rating", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /needs work/i }));
    expect(screen.getByText(/what was wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-tune this recipe/i })).toBeDisabled();
    expect(mockRateRecipe).not.toHaveBeenCalled();
  });

  it("saves the selected complaint through the rating endpoint", async () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /needs work/i }));
    fireEvent.click(screen.getByRole("button", { name: "Sour" }));

    await waitFor(() => {
      expect(mockRateRecipe).toHaveBeenCalledWith(RECIPE_ID, -1, "sour");
    });
    expect(screen.getByRole("button", { name: /re-tune this recipe/i })).toBeEnabled();
  });

  it("toggles a Good rating through the rating endpoint", async () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    const good = screen.getByRole("button", { name: /good/i });
    fireEvent.click(good);
    await waitFor(() => expect(mockRateRecipe).toHaveBeenLastCalledWith(RECIPE_ID, 1, null));
    fireEvent.click(good);
    await waitFor(() => expect(mockRateRecipe).toHaveBeenLastCalledWith(RECIPE_ID, 0, null));
  });

  it("calls the retune endpoint for a stored low-rating complaint", async () => {
    const needsWorkRecipe: Recipe = {
      ...COLD_RECIPE,
      rating: -1,
      ratingComplaint: "weak",
    };
    render(<RecipeResult recipe={needsWorkRecipe} recipeId={RECIPE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /re-tune this recipe/i }));

    await waitFor(() => expect(mockRetuneRecipe).toHaveBeenCalledWith(RECIPE_ID));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not re-tune/i);
  });

  it("hides feedback and delivery in read-only mode while preserving the admin back link", () => {
    render(
      <RecipeResult
        recipe={COLD_RECIPE}
        recipeId={RECIPE_ID}
        readOnly
        backHref="/admin/users/u1/recipes"
        backLabel="Back to User Recipes"
      />,
    );

    expect(screen.queryByText(/how was the cup/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/send to xbloom studio/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to User Recipes" })).toHaveAttribute(
      "href",
      "/admin/users/u1/recipes",
    );
  });
});
