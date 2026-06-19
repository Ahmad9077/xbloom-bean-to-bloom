import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RecipeResult from "../components/RecipeResult.js";
import type { Recipe } from "../types.js";

// Mock the api module so LocalBridge doesn't call real fetch
vi.mock("../api.js", () => ({
  checkBridge: vi.fn().mockResolvedValue(false),
  saveRecipe: vi.fn(),
  analyzeImage: vi.fn(),
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
    iceG: 80,
    totalBeverageMl: 240,
    instruction:
      "Serve over 80 g ice outside the xBloom machine. The xBloom machine has no cold setting — it always brews hot water.",
  },
};

const HOT_RECIPE: Recipe = {
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

describe("RecipeResult — cold recipe", () => {
  it("renders the recipe name", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ethiopia Iced Light Roast",
    );
  });

  it("shows 'Iced Pour-Over' badge", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByText(/iced pour-over/i)).toBeInTheDocument();
  });

  it("displays the iced serving section with ice amount", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByRole("region", { name: /iced serving/i })).toBeInTheDocument();
    expect(screen.getByText(/80 g ice/i)).toBeInTheDocument();
  });

  it("states ice is added outside the machine", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByText(/outside the xbloom machine/i)).toBeInTheDocument();
  });

  it("shows total beverage 240 ml", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getAllByText(/240 ml/i).length).toBeGreaterThan(0);
  });

  it("shows machine water volume (160 ml appears at least once)", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    // 160 ml appears in both the machine recipe section and the iced serving description
    expect(screen.getAllByText(/160 ml/i).length).toBeGreaterThan(0);
  });

  it("renders the pour timeline with all pours", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByText("Bloom")).toBeInTheDocument();
    expect(screen.getByText("Pour 2")).toBeInTheDocument();
    expect(screen.getByText("Pour 3")).toBeInTheDocument();
  });

  it("Start Over button calls onStartOver", async () => {
    const onStartOver = vi.fn();
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={onStartOver} />);
    await userEvent.click(screen.getByRole("button", { name: /start over/i }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });

  it("shows the Add to my xBloom bridge button", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add to my xbloom/i })).toBeInTheDocument();
  });
});

describe("RecipeResult — hot recipe", () => {
  it("shows 'Hot Pour-Over' badge", () => {
    render(<RecipeResult recipe={HOT_RECIPE} requestId="r-2" onStartOver={vi.fn()} />);
    expect(screen.getByText(/hot pour-over/i)).toBeInTheDocument();
  });

  it("does not show the iced serving section", () => {
    render(<RecipeResult recipe={HOT_RECIPE} requestId="r-2" onStartOver={vi.fn()} />);
    expect(screen.queryByRole("region", { name: /iced serving/i })).not.toBeInTheDocument();
  });

  it("does not mention 80 g ice", () => {
    render(<RecipeResult recipe={HOT_RECIPE} requestId="r-2" onStartOver={vi.fn()} />);
    expect(screen.queryByText(/80 g ice/i)).not.toBeInTheDocument();
  });
});

describe("RecipeResult — bean details and accessibility", () => {
  it("shows bean origin", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getAllByText(/ethiopia/i).length).toBeGreaterThan(0);
  });

  it("shows flavors as tags", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByText("blueberry")).toBeInTheDocument();
    expect(screen.getByText("jasmine")).toBeInTheDocument();
  });

  it("shows grind and RPM", () => {
    render(<RecipeResult recipe={COLD_RECIPE} requestId="r-1" onStartOver={vi.fn()} />);
    expect(screen.getByText("19")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});
