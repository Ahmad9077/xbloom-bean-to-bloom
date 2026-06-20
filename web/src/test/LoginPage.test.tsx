import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import LoginPage from "../pages/LoginPage.js";
import type { AuthUser } from "../types.js";

vi.mock("../api.js", () => ({
  apiMe: vi.fn().mockResolvedValue(null),
  apiLogin: vi.fn(),
  apiLogout: vi.fn(),
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

import { ApiError, apiLogin } from "../api.js";
const mockApiLogin = vi.mocked(apiLogin);

function renderLogin(user: AuthUser | null = null) {
  const login = vi.fn();
  const logout = vi.fn();

  if (user) {
    login.mockResolvedValue(undefined);
  } else {
    login.mockImplementation(async (username: string) => {
      if (mockApiLogin) {
        await mockApiLogin(username, "");
      }
    });
  }

  return {
    login,
    ...render(
      <AuthContext.Provider value={{ user, loading: false, login, logout }}>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div data-testid="home" />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage — rendering", () => {
  it("renders username and password fields", () => {
    renderLogin();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders login button", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
  });

  it("redirects to / when already authenticated", () => {
    renderLogin({ id: "1", username: "admin", role: "user" });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});

describe("LoginPage — client-side validation", () => {
  it("shows error when username is empty", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(screen.getAllByRole("alert").some((el) => /required/i.test(el.textContent ?? ""))).toBe(
      true,
    );
  });

  it("shows error when username is too short", async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), "ab");
    await userEvent.click(screen.getByRole("button", { name: /login/i }));
    await waitFor(() => {
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
    });
  });

  it("shows error when password is too short", async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), "validuser");
    await userEvent.type(screen.getByLabelText(/password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /login/i }));
    await waitFor(() => {
      expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    });
  });
});

describe("LoginPage — API errors", () => {
  it("shows invalid credential error on 401", async () => {
    const { login } = renderLogin();
    login.mockRejectedValue(new ApiError("Unauthorized", "UNAUTHORIZED", 401));

    await userEvent.type(screen.getByLabelText(/username/i), "baduser");
    await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword123");
    await userEvent.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid username or password/i);
    });
  });

  it("shows rate limit error on 429", async () => {
    const { login } = renderLogin();
    login.mockRejectedValue(new ApiError("Too many attempts", "RATE_LIMITED", 429));

    await userEvent.type(screen.getByLabelText(/username/i), "baduser");
    await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword123");
    await userEvent.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/too many login attempts/i);
    });
  });

  it("disables button while submitting", async () => {
    const { login } = renderLogin();
    login.mockImplementation(() => new Promise(() => {}));

    await userEvent.type(screen.getByLabelText(/username/i), "validuser");
    await userEvent.type(screen.getByLabelText(/password/i), "validpassword123");
    await userEvent.click(screen.getByRole("button", { name: /login/i }));

    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });
});
