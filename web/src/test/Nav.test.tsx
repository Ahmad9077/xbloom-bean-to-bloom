import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Nav from "../components/Nav.js";
import { AuthContext } from "../context/AuthContext.js";

vi.mock("../api.js", () => ({
  apiLogout: vi.fn().mockResolvedValue(undefined),
}));

const mockUserAuth = {
  user: { id: "1", username: "alice", role: "user" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const mockAdminAuth = {
  user: { id: "2", username: "admin", role: "admin" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

function renderNav(auth: typeof mockUserAuth | typeof mockAdminAuth = mockUserAuth) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <Nav />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("Nav — regular user", () => {
  it("shows New Recipe link", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /new recipe/i })).toBeInTheDocument();
  });

  it("shows History link", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /history/i })).toBeInTheDocument();
  });

  it("shows Logout button", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("does NOT show Admin Dashboard link", () => {
    renderNav();
    expect(screen.queryByRole("link", { name: /admin dashboard/i })).not.toBeInTheDocument();
  });
});

describe("Nav — admin user", () => {
  it("shows Admin Dashboard link for admin", () => {
    renderNav(mockAdminAuth);
    expect(screen.getByRole("link", { name: /admin dashboard/i })).toBeInTheDocument();
  });
});

describe("Nav — logout", () => {
  it("calls logout when Logout is clicked", async () => {
    renderNav();
    await userEvent.click(screen.getByRole("button", { name: /logout/i }));
    await waitFor(() => {
      expect(mockUserAuth.logout).toHaveBeenCalledOnce();
    });
  });
});
