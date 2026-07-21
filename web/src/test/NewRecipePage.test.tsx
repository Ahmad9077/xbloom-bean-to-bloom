import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import NewRecipePage from "../pages/NewRecipePage.js";
import type { PendingRecipeConfirmation } from "../types.js";

vi.mock("../api.js", () => ({
  apiCreateRecipe: vi.fn(),
  apiConfirmRecipe: vi.fn(),
  compressImage: vi.fn((file: File) => Promise.resolve(file)),
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

import { ApiError, apiConfirmRecipe, apiCreateRecipe, compressImage } from "../api.js";

const mockApiCreateRecipe = vi.mocked(apiCreateRecipe);
const mockApiConfirmRecipe = vi.mocked(apiConfirmRecipe);
const mockCompress = vi.mocked(compressImage);

if (!globalThis.URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake") });
}
if (!globalThis.URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

function makeJpeg(name = "bag.jpg"): File {
  return new File(["x".repeat(100)], name, { type: "image/jpeg" });
}

const PENDING_CONFIRMATION: PendingRecipeConfirmation = {
  ok: true,
  requestId: "request-1",
  needsConfirmation: true,
  confirmationId: "11111111-1111-4111-8111-111111111111",
  brewMode: "cold",
  strength: "strong",
  bean: {
    storeName: "Umq",
    beanName: "Yemen Haraz",
    coffeeType: "Arabica",
    variety: "Yemenia",
    origin: "",
    processingMethod: "unknown",
    roastLevel: "unknown",
    flavors: [],
    description: "",
  },
  missingFields: ["origin", "processingMethod", "roastLevel", "description"],
  suggestedProfile: "bright_funky",
  classifierConfidence: 0.82,
  profileOptions: [
    {
      id: "bright_funky",
      labelEn: "Funky natural",
      labelAr: "طبيعي / تخميري",
      emoji: "🍓",
    },
  ],
  analysisFallback: false,
  expiresAt: Date.now() + 10 * 60 * 1000,
};

const mockAuthValue = {
  user: { id: "1", username: "tester", role: "user" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

function renderPage() {
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<NewRecipePage />} />
          <Route path="/recipes/:id" element={<div data-testid="recipe-page" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function uploadPhotoAndSubmit() {
  await userEvent.upload(screen.getByLabelText(/album input/i), makeJpeg());
  await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockCompress.mockImplementation((file: File) => Promise.resolve(file));
});

describe("NewRecipePage — approved visual structure", () => {
  it("renders the approved hero, workflow, and V60 copy", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Bean to Bloom" })).toBeInTheDocument();
    expect(screen.getByText(/turn a bag photo or roaster link/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recipe creation steps/i)).toHaveTextContent("Choose your cup");
    expect(screen.getAllByText("V60").length).toBeGreaterThan(0);
    expect(document.querySelector(".coffee-bed")).toBeInTheDocument();
    expect(document.querySelectorAll(".aroma-lines span")).toHaveLength(3);
  });

  it("starts Cold and Strong on the left and lets the user change both", async () => {
    renderPage();
    expect(screen.getByRole("radio", { name: "Cold" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Strong" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    await userEvent.click(screen.getByRole("radio", { name: "Soft" }));
    expect(screen.getByRole("radio", { name: "Hot" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Soft" })).toBeChecked();
  });

  it("moves the hero artwork with scroll using transform-only updates", () => {
    const originalScrollY = window.scrollY;
    let animationFrame: FrameRequestCallback | undefined;
    const animationSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrame = callback;
        return 1;
      });

    renderPage();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 320 });
    fireEvent.scroll(window);
    animationFrame?.(0);

    const cup = document.querySelector<HTMLElement>(".v60-cone");
    const bean = document.querySelector<HTMLElement>(".bean-one");
    expect(cup?.style.transform).toContain("translate3d");
    expect(cup?.style.transform).toContain("rotateZ(-");
    expect(bean?.style.transform).toContain("translate3d");

    animationSpy.mockRestore();
    Object.defineProperty(window, "scrollY", { configurable: true, value: originalScrollY });
  });

  it("keeps the artwork static when reduced motion is requested", () => {
    const originalMatchMedia = window.matchMedia;
    const originalScrollY = window.scrollY;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 320 });

    renderPage();
    expect(document.querySelector<HTMLElement>(".v60-cone")?.style.transform).toBe("");
    expect(document.querySelector<HTMLElement>(".bean-one")?.style.transform).toBe("");

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window, "scrollY", { configurable: true, value: originalScrollY });
  });
});

describe("NewRecipePage — bean sources", () => {
  it("requires a photo or product link before scanning", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /create my recipe/i })).toBeDisabled();
  });

  it("accepts multiple photos and shows the selected count", async () => {
    renderPage();
    await userEvent.upload(screen.getByLabelText(/album input/i), [
      makeJpeg("front.jpg"),
      makeJpeg("back.jpg"),
    ]);
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByLabelText(/selected photos \(2 of 4\)/i)).toBeInTheDocument();
  });

  it("enables submission with a product URL and sends it without photos", async () => {
    mockApiCreateRecipe.mockResolvedValue(PENDING_CONFIRMATION);
    renderPage();
    await userEvent.type(
      screen.getByRole("textbox", { name: /product link/i }),
      "https://roaster.example/bean",
    );
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));

    await waitFor(() => {
      expect(mockApiCreateRecipe).toHaveBeenCalledWith(
        [],
        "cold",
        "strong",
        "https://roaster.example/bean",
      );
    });
  });

  it("uses clipboard text from Paste and silently focuses the field if clipboard fails", async () => {
    const readText = vi
      .fn()
      .mockResolvedValueOnce("https://roaster.example/pasted")
      .mockRejectedValueOnce(new Error("blocked"));
    Object.assign(navigator, { clipboard: { readText } });
    renderPage();

    const input = screen.getByRole("textbox", { name: /product link/i });
    await userEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(input).toHaveValue("https://roaster.example/pasted");

    await userEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(input).toHaveFocus();
    expect(screen.queryByText(/clipboard/i)).not.toBeInTheDocument();
  });

  it("explains that photos take precedence when both sources are present", async () => {
    renderPage();
    await userEvent.upload(screen.getByLabelText(/album input/i), makeJpeg());
    await userEvent.type(
      screen.getByRole("textbox", { name: /product link/i }),
      "https://roaster.example/bean",
    );
    expect(screen.getByText(/photos will be used for this request/i)).toBeInTheDocument();
  });
});

describe("NewRecipePage — scan and confirmation contract", () => {
  it("submits Cold/Strong and opens confirmation for the 202 response", async () => {
    mockApiCreateRecipe.mockResolvedValue(PENDING_CONFIRMATION);
    renderPage();
    await uploadPhotoAndSubmit();

    await waitFor(() => {
      expect(mockApiCreateRecipe).toHaveBeenCalledWith(expect.any(Array), "cold", "strong", "");
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm Below Details" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Umq")).toHaveAttribute("maxlength", "40");
    expect(screen.getByDisplayValue("Yemen Haraz")).toHaveAttribute("maxlength", "60");
    expect(screen.queryByText("Total Drink ml")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Drink size" })).not.toBeInTheDocument();
  });

  it("shows only missing metadata fields plus the always-required roast selector", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      bean: {
        ...PENDING_CONFIRMATION.bean,
        origin: "Yemen",
        processingMethod: "natural",
        roastLevel: "medium_light",
        flavors: ["red fruit"],
        description: "Red fruit",
      },
      missingFields: [],
    });
    renderPage();
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByLabelText("Origin")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Processing method")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/tasting notes/i)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Roast level")).toHaveValue("medium_light");
    expect(within(dialog).getByText(/preliminary guess:.*funky natural/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Strong")).toBeInTheDocument();
  });

  it("requires missing data and roast, then posts only the confirmed fields", async () => {
    mockApiCreateRecipe.mockResolvedValue(PENDING_CONFIRMATION);
    mockApiConfirmRecipe.mockResolvedValue({
      id: "recipe-1",
      link: "/recipes/recipe-1",
      recipe: {} as never,
    });
    renderPage();
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: /confirm and create recipe/i,
    });
    expect(confirmButton).toBeDisabled();
    expect(within(dialog).getByLabelText("Processing method")).toHaveValue("");

    await userEvent.type(within(dialog).getByLabelText("Origin"), "Yemen");
    await userEvent.selectOptions(within(dialog).getByLabelText("Processing method"), "natural");
    await userEvent.type(within(dialog).getByLabelText(/tasting notes/i), "Red fruit, cacao");
    await userEvent.selectOptions(within(dialog).getByLabelText("Roast level"), "light");
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockApiConfirmRecipe).toHaveBeenCalledWith(
        PENDING_CONFIRMATION.confirmationId,
        "Umq",
        "Yemen Haraz",
        {
          finalDrinkMl: 300,
          roastLevel: "light",
          origin: "Yemen",
          processingMethod: "natural",
          description: "Red fruit, cacao",
        },
      );
    });
    expect(screen.getByTestId("recipe-page")).toBeInTheDocument();
  });

  it("submits the established Hot Strong default without a size selector", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      brewMode: "hot",
      strength: "strong",
      bean: { ...PENDING_CONFIRMATION.bean, roastLevel: "light" },
      missingFields: [],
    });
    renderPage();
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("group", { name: "Drink size" })).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm and create recipe/i }),
    );
    await waitFor(() =>
      expect(mockApiConfirmRecipe).toHaveBeenCalledWith(
        PENDING_CONFIRMATION.confirmationId,
        "Umq",
        "Yemen Haraz",
        { finalDrinkMl: 252, roastLevel: "light" },
      ),
    );
  });

  it("submits the established Hot Soft default without a size selector", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      brewMode: "hot",
      strength: "soft",
      bean: { ...PENDING_CONFIRMATION.bean, roastLevel: "light" },
      missingFields: [],
    });
    renderPage();
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    await userEvent.click(screen.getByRole("radio", { name: "Soft" }));
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("group", { name: "Drink size" })).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm and create recipe/i }),
    );
    await waitFor(() =>
      expect(mockApiConfirmRecipe).toHaveBeenCalledWith(
        PENDING_CONFIRMATION.confirmationId,
        "Umq",
        "Yemen Haraz",
        { finalDrinkMl: 255, roastLevel: "light" },
      ),
    );
  });

  it("returns to the form when Cancel is selected", async () => {
    mockApiCreateRecipe.mockResolvedValue(PENDING_CONFIRMATION);
    renderPage();
    await uploadPhotoAndSubmit();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("marks a cached confirmation response in session storage before navigating", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      bean: { ...PENDING_CONFIRMATION.bean, roastLevel: "medium" },
      missingFields: [],
    });
    mockApiConfirmRecipe.mockResolvedValue({
      id: "cached-recipe",
      link: "/recipes/cached-recipe",
      recipe: {} as never,
      cached: true,
    });
    renderPage();
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm and create recipe/i }),
    );

    await waitFor(() => {
      expect(sessionStorage.getItem("xbloom:cachedRecipe")).toBe("cached-recipe");
      expect(screen.getByTestId("recipe-page")).toBeInTheDocument();
    });
  });

  it("navigates after a cached response when session storage is unavailable", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      bean: { ...PENDING_CONFIRMATION.bean, roastLevel: "medium" },
      missingFields: [],
    });
    mockApiConfirmRecipe.mockResolvedValue({
      id: "cached-recipe",
      link: "/recipes/cached-recipe",
      recipe: {} as never,
      cached: true,
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    renderPage();
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm and create recipe/i }),
    );

    expect(await screen.findByTestId("recipe-page")).toBeInTheDocument();
  });

  it("keeps the dialog open and shows a safe confirmation error", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      ...PENDING_CONFIRMATION,
      bean: { ...PENDING_CONFIRMATION.bean, roastLevel: "medium" },
      missingFields: [],
    });
    mockApiConfirmRecipe.mockRejectedValue(
      new ApiError("technical detail", "RECIPE_UPSTREAM_MALFORMED", 502),
    );
    renderPage();
    await uploadPhotoAndSubmit();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm and create recipe/i }),
    );

    expect(
      await within(dialog).findByText(/recommendation service did not return a usable recipe/i),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("technical detail")).not.toBeInTheDocument();
  });
});

describe("NewRecipePage — request errors", () => {
  it("shows the safe scan error and clears uploaded photos", async () => {
    mockApiCreateRecipe.mockRejectedValue(
      new ApiError("upstream internals", "UPSTREAM_ERROR", 502),
    );
    renderPage();
    await uploadPhotoAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't complete the AI analysis/i,
    );
    expect(screen.getByText("0/4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create my recipe/i })).toBeDisabled();
  });

  it("still supports an immediate created response defensively", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      id: "recipe-direct",
      link: "/recipes/recipe-direct",
      recipe: {} as never,
    });
    renderPage();
    await uploadPhotoAndSubmit();
    expect(await screen.findByTestId("recipe-page")).toBeInTheDocument();
  });
});
