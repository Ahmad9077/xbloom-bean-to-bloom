import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecipeResult from "../components/RecipeResult.js";
import type { Recipe } from "../types.js";

vi.mock("../api.js", () => ({
  apiCreateBridgeJob: vi.fn().mockResolvedValue({ id: "j1", status: "pending" }),
  apiGetBridgeJob: vi.fn().mockResolvedValue({ id: "j1", status: "pending" }),
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

const BASE_BEAN = {
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
};

const RECIPE_ID = "abc123";

beforeEach(() => {
  vi.clearAllMocks();
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

  it("shows 'Iced Pour-Over' badge", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/iced pour-over/i)).toBeInTheDocument();
  });

  it("displays the iced serving section with ice amount", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByRole("region", { name: /ice required/i })).toBeInTheDocument();
    expect(screen.getAllByText(/140 g/i).length).toBeGreaterThan(0);
  });

  it("states ice is added outside the machine", () => {
    render(<RecipeResult recipe={COLD_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/before starting/i)).toBeInTheDocument();
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
  });
});

describe("RecipeResult — hot recipe", () => {
  it("shows 'Hot Pour-Over' badge", () => {
    render(<RecipeResult recipe={HOT_RECIPE} recipeId={RECIPE_ID} />);
    expect(screen.getByText(/hot pour-over/i)).toBeInTheDocument();
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
