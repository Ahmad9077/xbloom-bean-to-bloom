import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.js";
import type { WorkerResponse } from "../types.js";

vi.mock("../api.js", () => ({
  analyzeImage: vi.fn(),
  checkBridge: vi.fn(),
  saveRecipe: vi.fn(),
}));

import { analyzeImage } from "../api.js";
const mockAnalyze = vi.mocked(analyzeImage);

// jsdom URL stubs
if (!globalThis.URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake") });
}
if (!globalThis.URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

function makeJpeg(): File {
  return new File(["x".repeat(100)], "bag.jpg", { type: "image/jpeg" });
}

const COLD_RECIPE_RESPONSE: WorkerResponse = {
  ok: true,
  requestId: "req-1",
  recipe: {
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
    bean: {
      coffeeType: "Single Origin",
      variety: "Heirloom",
      origin: "Ethiopia",
      processingMethod: "Washed",
      roastLevel: "light",
      flavors: ["blueberry"],
      description: "Bright Ethiopian.",
    },
    icedServing: { iceG: 80, totalBeverageMl: 240, instruction: "Serve over 80 g ice." },
  },
};

const HOT_RECIPE_RESPONSE: WorkerResponse = {
  ok: true,
  requestId: "req-2",
  recipe: {
    ...COLD_RECIPE_RESPONSE.recipe,
    name: "Ethiopia Light Roast",
    brewMode: "hot",
    brewRatio: "1:14",
    totalVolumeMl: 224,
    icedServing: undefined,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App — upload screen defaults", () => {
  it("renders the mode selector on load", () => {
    render(<App />);
    expect(screen.getByRole("radiogroup", { name: /brew mode/i })).toBeInTheDocument();
  });

  it("Cold is selected by default", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: "Cold" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hot" })).not.toBeChecked();
  });

  it("shows the question heading before upload", () => {
    render(<App />);
    expect(screen.getByText(/how do you want your coffee/i)).toBeInTheDocument();
  });

  it("Create my recipe button is disabled when no file is uploaded", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /create my recipe/i })).toBeDisabled();
  });
});

describe("App — brew mode selection before submit", () => {
  it("user can switch to Hot before submitting", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    expect(screen.getByRole("radio", { name: "Hot" })).toBeChecked();
  });

  it("request includes Cold brewMode when Cold is selected", async () => {
    mockAnalyze.mockResolvedValue(COLD_RECIPE_RESPONSE);
    render(<App />);

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());

    // Submit — Cold is the default
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    expect(mockAnalyze).toHaveBeenCalledWith(expect.any(File), "cold");
  });

  it("request includes Hot brewMode when Hot is selected", async () => {
    mockAnalyze.mockResolvedValue(HOT_RECIPE_RESPONSE);
    render(<App />);

    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());

    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    expect(mockAnalyze).toHaveBeenCalledWith(expect.any(File), "hot");
  });
});

describe("App — result screen", () => {
  it("shows cold recipe result with iced note after successful API call", async () => {
    mockAnalyze.mockResolvedValue(COLD_RECIPE_RESPONSE);
    render(<App />);

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Ethiopia Iced Light Roast",
      );
    });
    expect(screen.getByText(/iced serving/i)).toBeInTheDocument();
    expect(screen.getByText(/80 g ice/i)).toBeInTheDocument();
  });

  it("shows hot recipe result without iced note", async () => {
    mockAnalyze.mockResolvedValue(HOT_RECIPE_RESPONSE);
    render(<App />);

    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ethiopia Light Roast");
    });
    expect(screen.queryByText(/iced serving/i)).not.toBeInTheDocument();
  });

  it("Start Over returns to upload screen with Cold re-selected", async () => {
    mockAnalyze.mockResolvedValue(COLD_RECIPE_RESPONSE);
    render(<App />);

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Ethiopia Iced Light Roast",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /start over/i }));

    expect(screen.getByText(/how do you want your coffee/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cold" })).toBeChecked();
  });
});

describe("App — error handling", () => {
  it("shows error message when API returns ok:false", async () => {
    mockAnalyze.mockResolvedValue({
      ok: false,
      requestId: "req-err",
      error: { code: "UPSTREAM_MALFORMED", message: "AI returned garbage." },
    });
    render(<App />);

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/AI returned garbage/i);
    });
  });

  it("shows requestId when error response includes one", async () => {
    mockAnalyze.mockResolvedValue({
      ok: false,
      requestId: "req-abc123",
      error: { code: "BAD_REQUEST", message: "Bad file." },
    });
    render(<App />);

    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    await userEvent.upload(input, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(screen.getByText(/req-abc123/i)).toBeInTheDocument();
    });
  });
});

describe("App — accessibility", () => {
  it("upload section has a visible heading", () => {
    render(<App />);
    expect(screen.getByText(/upload your bean bag photo/i)).toBeInTheDocument();
  });

  it("privacy copy is visible", () => {
    render(<App />);
    expect(screen.getByText(/not stored/i)).toBeInTheDocument();
  });
});
