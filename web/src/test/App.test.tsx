import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.js";

// Mock ALL api module functions
vi.mock("../api.js", () => ({
  apiMe: vi.fn(),
  apiLogin: vi.fn(),
  apiLogout: vi.fn(),
  apiCreateRecipe: vi.fn(),
  apiGetRecipe: vi.fn(),
  apiGetRecipes: vi.fn(),
  apiCreateBridgeJob: vi.fn(),
  apiGetBridgeJob: vi.fn(),
  apiGetUsers: vi.fn(),
  apiCreateUser: vi.fn(),
  apiUpdateUser: vi.fn(),
  apiDeleteUser: vi.fn(),
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

import { apiMe } from "../api.js";
const mockApiMe = vi.mocked(apiMe);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App — unauthenticated", () => {
  it("redirects to /login when not authenticated", async () => {
    mockApiMe.mockResolvedValue(null);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: /bean to bloom/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
    });
  });
});

describe("App — authenticated user", () => {
  it("shows new recipe page for authenticated user at /", async () => {
    mockApiMe.mockResolvedValue({ id: "1", username: "tester", role: "user" });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: /brew mode/i })).toBeInTheDocument();
    });
  });

  it("shows nav with New Recipe and History links", async () => {
    mockApiMe.mockResolvedValue({ id: "1", username: "tester", role: "user" });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /new recipe/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /history/i })).toBeInTheDocument();
    });
  });

  it("does not show Admin Dashboard link for non-admin", async () => {
    mockApiMe.mockResolvedValue({ id: "1", username: "tester", role: "user" });
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /admin dashboard/i })).not.toBeInTheDocument();
    });
  });
});

describe("App — authenticated admin", () => {
  it("shows Admin Dashboard link for admin", async () => {
    mockApiMe.mockResolvedValue({ id: "1", username: "admin", role: "admin" });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /admin dashboard/i })).toBeInTheDocument();
    });
  });
});
