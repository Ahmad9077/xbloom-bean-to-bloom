import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MultiPhotoUpload from "../components/MultiPhotoUpload.js";

// jsdom doesn't implement URL.createObjectURL
if (!globalThis.URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake") });
}
if (!globalThis.URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

function makeFile(name: string, type: string, size = 1024): File {
  const blob = new Blob(["x".repeat(size)], { type });
  return new File([blob], name, { type });
}

describe("MultiPhotoUpload — initial state", () => {
  it("shows Take photo and Choose from album buttons when no files", () => {
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose from album/i })).toBeInTheDocument();
  });

  it("shows instruction text when no files", () => {
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/up to 4 photos/i)).toBeInTheDocument();
  });
});

describe("MultiPhotoUpload — file acceptance", () => {
  it("accepts JPEG from album input and calls onChange", async () => {
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("bag.jpg", "image/jpeg");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith([file]);
  });

  it("accepts PNG file", async () => {
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("bag.png", "image/png");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith([file]);
  });

  it("accepts WebP file", async () => {
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("bag.webp", "image/webp");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith([file]);
  });
});

describe("MultiPhotoUpload — HEIC rejection", () => {
  it("shows HEIC unsupported error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("photo.heic", "image/heic");
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/heic.*not supported/i);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows HEIC error for .heif extension", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("photo.heif", "image/heif");
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/heic.*not supported/i);
    });
  });
});

describe("MultiPhotoUpload — unsupported format", () => {
  it("rejects BMP and shows error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("bag.bmp", "image/bmp");
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unsupported format/i);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MultiPhotoUpload — size validation", () => {
  it("rejects a file that is too large", async () => {
    const onChange = vi.fn();
    render(<MultiPhotoUpload files={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/album input/i);
    const file = makeFile("big.jpg", "image/jpeg", 11 * 1024 * 1024);
    await userEvent.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MultiPhotoUpload — multi-photo grid", () => {
  it("shows photo grid with remove buttons when files present", () => {
    const file = makeFile("bag.jpg", "image/jpeg");
    render(<MultiPhotoUpload files={[file]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /remove photo 1/i })).toBeInTheDocument();
  });

  it("shows photo count", () => {
    const files = [makeFile("a.jpg", "image/jpeg"), makeFile("b.jpg", "image/jpeg")];
    render(<MultiPhotoUpload files={files} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/selected photos \(2 of 4\)/i)).toBeInTheDocument();
  });

  it("calls onChange with file removed when remove button clicked", async () => {
    const onChange = vi.fn();
    const files = [makeFile("a.jpg", "image/jpeg"), makeFile("b.jpg", "image/jpeg")];
    render(<MultiPhotoUpload files={files} onChange={onChange} />);
    const firstRemove = screen.getAllByRole("button", { name: /remove photo/i })[0];
    if (!firstRemove) throw new Error("Remove button missing");
    await userEvent.click(firstRemove);
    expect(onChange).toHaveBeenCalledWith([files[1]]);
  });

  it("hides add buttons when 4 photos selected", () => {
    const files = Array.from({ length: 4 }, (_, i) => makeFile(`f${i}.jpg`, "image/jpeg"));
    render(<MultiPhotoUpload files={files} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /take photo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose from album/i })).not.toBeInTheDocument();
  });

  it("camera input has capture=environment attribute", () => {
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} />);
    const cameraInput = screen.getByLabelText(/camera input/i);
    expect(cameraInput).toHaveAttribute("capture", "environment");
  });

  it("album input has multiple attribute and no capture", () => {
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} />);
    const albumInput = screen.getByLabelText(/album input/i);
    expect(albumInput).toHaveAttribute("multiple");
    expect(albumInput).not.toHaveAttribute("capture");
  });
});

describe("MultiPhotoUpload — disabled state", () => {
  it("disables inputs when disabled=true", () => {
    render(<MultiPhotoUpload files={[]} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText(/camera input/i)).toBeDisabled();
    expect(screen.getByLabelText(/album input/i)).toBeDisabled();
  });
});
