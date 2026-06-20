import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CloudBridge from "../components/CloudBridge.js";

vi.mock("../api.js", () => ({
  apiCreateBridgeJob: vi.fn(),
  apiGetBridgeJob: vi.fn(),
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

import { ApiError, apiCreateBridgeJob, apiGetBridgeJob } from "../api.js";
const mockCreate = vi.mocked(apiCreateBridgeJob);
const mockGet = vi.mocked(apiGetBridgeJob);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CloudBridge — initial state", () => {
  it("shows connecting state initially", async () => {
    mockCreate.mockImplementation(() => new Promise(() => {}));
    render(<CloudBridge recipeId="r1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("CloudBridge — pending state", () => {
  it("shows pending state after job is created", async () => {
    mockCreate.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });
    mockGet.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });

    render(<CloudBridge recipeId="r1" />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/waiting for mac bridge/i);
    });
  });

  it("explains the cloud bridge to user without exposing paths", async () => {
    mockCreate.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });
    mockGet.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });

    render(<CloudBridge recipeId="r1" />);

    await waitFor(() => {
      expect(screen.getByText(/cloud bridge job/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/127\.0\.0\.1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/localhost/)).not.toBeInTheDocument();
  });
});

describe("CloudBridge — completed state", () => {
  it("shows success when job completes", async () => {
    mockCreate.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
    });
    mockGet.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
    });

    render(<CloudBridge recipeId="r1" />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/sent to xbloom studio/i);
    });
  });
});

describe("CloudBridge — failed state", () => {
  it("shows failure when job fails", async () => {
    mockCreate.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "failed",
      safeError: "Bridge timed out.",
      createdAt: 0,
      updatedAt: 0,
    });
    mockGet.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "failed",
      safeError: "Bridge timed out.",
      createdAt: 0,
      updatedAt: 0,
    });

    render(<CloudBridge recipeId="r1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/bridge delivery failed/i);
    });
    expect(screen.getByText(/bridge timed out/i)).toBeInTheDocument();
  });
});

describe("CloudBridge — API error", () => {
  it("shows error when job creation fails", async () => {
    mockCreate.mockRejectedValue(new ApiError("Not authorized", "UNAUTHORIZED", 401));

    render(<CloudBridge recipeId="r1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/bridge job unavailable/i);
    });
  });

  it("never calls localhost or 127.0.0.1 — uses same-origin API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mockCreate.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });
    mockGet.mockResolvedValue({
      id: "j1",
      recipeId: "r1",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });

    render(<CloudBridge recipeId="r1" />);

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toMatch(/127\.0\.0\.1/);
      expect(url).not.toMatch(/localhost/);
    }
  });
});
