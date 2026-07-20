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
  it("shows New Recipe navigation", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /new recipe/i })).toBeInTheDocument();
  });

  it("shows History navigation", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /history/i })).toBeInTheDocument();
  });

  it("shows Logout button", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("does NOT show Admin Dashboard navigation", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: /admin dashboard/i })).not.toBeInTheDocument();
  });
});

describe("Nav — admin user", () => {
  it("shows Admin Dashboard navigation for admin", () => {
    renderNav(mockAdminAuth);
    expect(screen.getByRole("button", { name: /admin dashboard/i })).toBeInTheDocument();
  });
});

describe("Nav — mobile menu", () => {
  it("opens an accessible dialog and closes it with Escape", async () => {
    renderNav();
    const opener = screen.getByRole("button", { name: /open menu/i });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: /mobile navigation/i })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /mobile navigation/i })).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
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
