import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CloudBridge from "../components/CloudBridge.js";
import type { BridgeJob } from "../types.js";

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

import { apiCreateBridgeJob, apiGetBridgeJob } from "../api.js";
const mockCreate = vi.mocked(apiCreateBridgeJob);
const mockGet = vi.mocked(apiGetBridgeJob);

const PENDING_JOB: BridgeJob = {
  id: "j-1",
  recipeId: "r-1",
  status: "pending",
  createdAt: Date.parse("2024-01-01T00:00:00Z"),
  updatedAt: Date.parse("2024-01-01T00:00:00Z"),
  safeError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CloudBridge — initial state", () => {
  it("renders the initial connecting status", async () => {
    mockCreate.mockImplementation(() => new Promise(() => {}));
    render(<CloudBridge recipeId="r-1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("CloudBridge — bridge available, pending", () => {
  it("shows pending state after job created", async () => {
    mockCreate.mockResolvedValue(PENDING_JOB);
    mockGet.mockResolvedValue(PENDING_JOB);

    render(<CloudBridge recipeId="r-1" />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/waiting for mac bridge/i);
    });
  });

  it("explains the bridge without exposing server paths", async () => {
    mockCreate.mockResolvedValue(PENDING_JOB);
    mockGet.mockResolvedValue(PENDING_JOB);

    render(<CloudBridge recipeId="r-1" />);

    await waitFor(() => {
      expect(screen.getByText(/cloud bridge job/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/127\.0\.0\.1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/localhost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local-service/)).not.toBeInTheDocument();
  });
});

describe("CloudBridge — completed", () => {
  it("shows success when job completes", async () => {
    mockCreate.mockResolvedValue({ ...PENDING_JOB, status: "completed" });
    mockGet.mockResolvedValue({ ...PENDING_JOB, status: "completed" });

    render(<CloudBridge recipeId="r-1" />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/sent to xbloom studio/i);
    });
  });
});

describe("CloudBridge — failed", () => {
  it("shows failure alert when job fails", async () => {
    mockCreate.mockResolvedValue({ ...PENDING_JOB, status: "failed", safeError: "App timed out." });
    mockGet.mockResolvedValue({ ...PENDING_JOB, status: "failed", safeError: "App timed out." });

    render(<CloudBridge recipeId="r-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/bridge delivery failed/i);
    });
    expect(screen.getByText(/app timed out/i)).toBeInTheDocument();
  });
});
