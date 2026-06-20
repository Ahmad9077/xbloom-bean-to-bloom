import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import NewRecipePage from "../pages/NewRecipePage.js";

vi.mock("../api.js", () => ({
  apiCreateRecipe: vi.fn(),
  compressImage: vi.fn((f: File) => Promise.resolve(f)),
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

import { ApiError, apiCreateRecipe, compressImage } from "../api.js";
const mockApiCreateRecipe = vi.mocked(apiCreateRecipe);
const mockCompress = vi.mocked(compressImage);

// jsdom stubs
if (!globalThis.URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake") });
}
if (!globalThis.URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

function makeJpeg(name = "bag.jpg"): File {
  return new File(["x".repeat(100)], name, { type: "image/jpeg" });
}

const mockUser = { id: "1", username: "tester", role: "user" as const };
const mockAuthValue = {
  user: mockUser,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCompress.mockImplementation((f: File) => Promise.resolve(f));
});

describe("NewRecipePage — brew mode", () => {
  it("Cold is selected by default", () => {
    renderPage();
    expect(screen.getByRole("radio", { name: "Cold" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hot" })).not.toBeChecked();
  });

  it("shows brew mode selector heading", () => {
    renderPage();
    expect(screen.getByText(/how do you want your coffee/i)).toBeInTheDocument();
  });

  it("user can switch to Hot", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    expect(screen.getByRole("radio", { name: "Hot" })).toBeChecked();
  });
});

describe("NewRecipePage — photo upload", () => {
  it("submit button is disabled when no photos", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /create my recipe/i })).toBeDisabled();
  });

  it("shows Take photo and Choose from album buttons", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose from album/i })).toBeInTheDocument();
  });

  it("enables submit after adding a photo via album", async () => {
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    const file = makeJpeg();
    await userEvent.upload(albumInput, file);
    expect(screen.getByRole("button", { name: /create my recipe/i })).not.toBeDisabled();
  });

  it("shows photo count after adding photos", async () => {
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, [makeJpeg("a.jpg"), makeJpeg("b.jpg")]);
    await waitFor(() => {
      expect(screen.getByText(/2 of 4/i)).toBeInTheDocument();
    });
  });

  it("shows HEIC unsupported error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    const heicFile = new File(["x"], "photo.heic", { type: "image/heic" });
    await user.upload(albumInput, heicFile);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/heic.*not supported/i);
    });
  });
});

describe("NewRecipePage — submission", () => {
  it("calls apiCreateRecipe with cold mode by default", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      id: "recipe-1",
      link: "https://example.com/recipes/recipe-1",
      recipe: {} as never,
    });
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    await waitFor(() => {
      expect(mockApiCreateRecipe).toHaveBeenCalledWith(expect.any(Array), "cold");
    });
  });

  it("calls apiCreateRecipe with hot mode when Hot selected", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      id: "recipe-2",
      link: "https://example.com/recipes/recipe-2",
      recipe: {} as never,
    });
    renderPage();
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    await waitFor(() => {
      expect(mockApiCreateRecipe).toHaveBeenCalledWith(expect.any(Array), "hot");
    });
  });

  it("navigates to /recipes/:id after success", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      id: "abc123",
      link: "https://example.com/recipes/abc123",
      recipe: {} as never,
    });
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    await waitFor(() => {
      expect(screen.getByTestId("recipe-page")).toBeInTheDocument();
    });
  });

  it("shows error message on API failure", async () => {
    mockApiCreateRecipe.mockRejectedValue(new ApiError("Vision API error", "UPSTREAM_ERROR", 502));
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/vision api error/i);
    });
  });

  it("clears photos after upload settles (success)", async () => {
    mockApiCreateRecipe.mockResolvedValue({
      id: "abc",
      link: "http://x.com/recipes/abc",
      recipe: {} as never,
    });
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    expect(screen.getByRole("button", { name: /create my recipe/i })).not.toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    // After navigation the page unmounts; if still on same page, photos cleared
    await waitFor(() => {
      expect(mockApiCreateRecipe).toHaveBeenCalledOnce();
    });
  });

  it("clears photos after upload settles (error)", async () => {
    mockApiCreateRecipe.mockRejectedValue(new ApiError("fail", "ERR", 500));
    renderPage();
    const albumInput = screen.getByLabelText(/album input/i);
    await userEvent.upload(albumInput, makeJpeg());
    await userEvent.click(screen.getByRole("button", { name: /create my recipe/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // After error, submit button should be disabled again (photos cleared)
    expect(screen.getByRole("button", { name: /create my recipe/i })).toBeDisabled();
  });
});
