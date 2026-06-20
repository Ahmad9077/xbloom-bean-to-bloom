import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext.js";
import AdminPage from "../pages/AdminPage.js";
import type { AdminUser } from "../types.js";

vi.mock("../api.js", () => ({
  apiGetUsers: vi.fn(),
  apiCreateUser: vi.fn(),
  apiUpdateUser: vi.fn(),
  apiDeleteUser: vi.fn(),
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

import { apiCreateUser, apiDeleteUser, apiGetUsers, apiUpdateUser } from "../api.js";
const mockGetUsers = vi.mocked(apiGetUsers);
const mockCreateUser = vi.mocked(apiCreateUser);
const mockDeleteUser = vi.mocked(apiDeleteUser);
const mockUpdateUser = vi.mocked(apiUpdateUser);

const ADMIN_AUTH = {
  user: { id: "1", username: "admin", role: "admin" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const USER_AUTH = {
  user: { id: "2", username: "tester", role: "user" as const },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

const USERS: AdminUser[] = [
  {
    id: "1",
    username: "admin",
    role: "admin",
    enabled: true,
    isPrimary: true,
    recipeCount: 5,
    createdAt: Date.parse("2024-01-01T00:00:00Z"),
  },
  {
    id: "2",
    username: "alice",
    role: "user",
    enabled: true,
    isPrimary: false,
    recipeCount: 3,
    createdAt: Date.parse("2024-01-10T00:00:00Z"),
  },
  {
    id: "3",
    username: "bob",
    role: "user",
    enabled: false,
    isPrimary: false,
    recipeCount: 0,
    createdAt: Date.parse("2024-01-12T00:00:00Z"),
  },
];

function renderPage(auth: typeof ADMIN_AUTH | typeof USER_AUTH = ADMIN_AUTH) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUsers.mockResolvedValue(USERS);
});

describe("AdminPage — authorization", () => {
  it("redirects non-admin user to /", () => {
    renderPage(USER_AUTH);
    // AdminPage renders <Navigate to="/" />
    expect(screen.queryByText(/admin dashboard/i)).not.toBeInTheDocument();
  });

  it("shows dashboard for admin", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /admin dashboard/i })).toBeInTheDocument();
    });
  });
});

describe("AdminPage — user list", () => {
  it("shows all users", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
    });
  });

  it("shows recipe counts", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("marks primary admin", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/primary admin/i)).toBeInTheDocument();
    });
  });

  it("never shows password hashes", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText(/pbkdf2/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sha256/i)).not.toBeInTheDocument();
    });
  });
});

describe("AdminPage — primary admin protection", () => {
  it("does not show Delete button for primary admin", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
    // Primary admin row should not have a Delete button
    // The table has rows for admin, alice, bob. Alice and bob have delete buttons.
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButtons).toHaveLength(2); // alice and bob only
  });

  it("does not show enable/disable toggle for primary admin (shows static text)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
    // Primary admin row shows static "Enabled" text, not a button
    const enabledButtons = screen.getAllByRole("button", { name: /enable|disable/i });
    expect(enabledButtons).toHaveLength(2); // alice (enabled) and bob (disabled)
  });
});

describe("AdminPage — delete confirmation", () => {
  it("shows confirmation dialog with permanent deletion warning", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete alice/i });
    const deleteAlice = deleteButtons[0];
    if (!deleteAlice) throw new Error("Delete button missing");
    await userEvent.click(deleteAlice);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument();
    expect(screen.getByText(/recipe history/i)).toBeInTheDocument();
  });

  it("deletes user when confirmed", async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    mockGetUsers.mockResolvedValueOnce(USERS).mockResolvedValue(USERS.filter((u) => u.id !== "2"));

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete alice/i });
    const deleteAlice = deleteButtons[0];
    if (!deleteAlice) throw new Error("Delete button missing");
    await userEvent.click(deleteAlice);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete permanently/i }));

    await waitFor(() => {
      expect(mockDeleteUser).toHaveBeenCalledWith("2");
    });
  });

  it("cancels deletion when Cancel clicked", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete alice/i });
    const deleteAlice = deleteButtons[0];
    if (!deleteAlice) throw new Error("Delete button missing");
    await userEvent.click(deleteAlice);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});

describe("AdminPage — create user", () => {
  it("shows create user form when button clicked", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));
    expect(screen.getByRole("form", { name: /create new user/i })).toBeInTheDocument();
  });

  it("validates username length", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));
    await userEvent.type(screen.getByLabelText(/^username$/i), "ab");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(
        screen.getAllByRole("alert").some((el) => /at least 3/i.test(el.textContent ?? "")),
      ).toBe(true);
    });
  });

  it("validates password length", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));
    await userEvent.type(screen.getByLabelText(/^username$/i), "validuser");
    await userEvent.type(screen.getByLabelText(/^password$/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(
        screen.getAllByRole("alert").some((el) => /at least 4/i.test(el.textContent ?? "")),
      ).toBe(true);
    });
  });

  it("calls apiCreateUser with correct args", async () => {
    mockCreateUser.mockResolvedValue({
      id: "4",
      username: "newuser",
      role: "user",
      enabled: true,
      isPrimary: false,
      recipeCount: 0,
      createdAt: Date.parse("2024-01-20T00:00:00Z"),
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));
    await userEvent.type(screen.getByLabelText(/^username$/i), "newuser");
    await userEvent.type(screen.getByLabelText(/^password$/i), "securepassword123");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateUser).toHaveBeenCalledWith("newuser", "securepassword123", "user");
    });
  });
});

describe("AdminPage — enable/disable", () => {
  it("calls apiUpdateUser with enabled=false when disabling alice", async () => {
    mockUpdateUser.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disable alice/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /disable alice/i }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith("2", { enabled: false });
    });
  });
});
