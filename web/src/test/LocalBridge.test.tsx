import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocalBridge from "../components/LocalBridge.js";
import type { Recipe } from "../types.js";

// Mock the api module
vi.mock("../api.js", () => ({
  checkBridge: vi.fn(),
  saveRecipe: vi.fn(),
}));

import { checkBridge, saveRecipe } from "../api.js";

const mockCheckBridge = vi.mocked(checkBridge);
const mockSaveRecipe = vi.mocked(saveRecipe);

const RECIPE: Recipe = {
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
      volumeMl: 160,
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
    flavors: [],
    description: "Test.",
  },
  icedServing: { iceG: 80, totalBeverageMl: 240, instruction: "Serve over ice." },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocalBridge — initial state", () => {
  it("renders the Add to my xBloom button initially", () => {
    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-1" />);
    expect(screen.getByRole("button", { name: /add to my xbloom/i })).toBeInTheDocument();
  });

  it("explains the bridge requirement", () => {
    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-1" />);
    expect(screen.getByText(/mac emulator bridge/i)).toBeInTheDocument();
  });
});

describe("LocalBridge — bridge available, save succeeds", () => {
  it("shows saving state then saved state on success", async () => {
    mockCheckBridge.mockResolvedValue(true);
    mockSaveRecipe.mockResolvedValue({
      ok: true,
      jobId: "j-1",
      requestId: "r-1",
      recipeName: RECIPE.name,
      message: "Recipe saved successfully",
    });

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-1" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    });
    expect(screen.getByText(/ethiopia iced light roast/i)).toBeInTheDocument();
  });
});

describe("LocalBridge — bridge unavailable", () => {
  it("shows unavailable message when bridge check fails", async () => {
    mockCheckBridge.mockResolvedValue(false);

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-2" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/bridge not available/i);
    });
    expect(screen.getByText(/not running/i)).toBeInTheDocument();
  });

  it("shows a Try again button when unavailable", async () => {
    mockCheckBridge.mockResolvedValue(false);

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-2" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });
});

describe("LocalBridge — save error", () => {
  it("shows error state when saveRecipe returns ok:false", async () => {
    mockCheckBridge.mockResolvedValue(true);
    mockSaveRecipe.mockResolvedValue({
      ok: false,
      requestId: "r-1",
      error: { code: "SAVE_FAILED", message: "App timed out." },
    });

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-3" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/save failed/i);
    });
    expect(screen.getByText(/app timed out/i)).toBeInTheDocument();
  });

  it("shows error state when saveRecipe throws (network error)", async () => {
    mockCheckBridge.mockResolvedValue(true);
    mockSaveRecipe.mockRejectedValue(new Error("Connection refused"));

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-4" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/save failed/i);
    });
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("shows Try again after error", async () => {
    mockCheckBridge.mockResolvedValue(true);
    mockSaveRecipe.mockRejectedValue(new Error("Connection refused"));

    render(<LocalBridge recipe={RECIPE} idempotencyKey="key-5" />);
    await userEvent.click(screen.getByRole("button", { name: /add to my xbloom/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });
});
