import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ImageUpload from "../components/ImageUpload.js";

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

describe("ImageUpload", () => {
  it("renders the upload drop zone when no file is selected", () => {
    render(<ImageUpload file={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });

  it("accepts a valid JPEG file and calls onChange", async () => {
    const onChange = vi.fn();
    render(<ImageUpload file={null} onChange={onChange} />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    const file = makeFile("bag.jpg", "image/jpeg");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it("accepts a valid PNG file", async () => {
    const onChange = vi.fn();
    render(<ImageUpload file={null} onChange={onChange} />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    const file = makeFile("bag.png", "image/png");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it("accepts a valid WebP file", async () => {
    const onChange = vi.fn();
    render(<ImageUpload file={null} onChange={onChange} />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    const file = makeFile("bag.webp", "image/webp");
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it("rejects an unsupported format and shows error", async () => {
    const onChange = vi.fn();
    // applyAccept:false bypasses the input's accept attribute so the JS validator runs
    const user = userEvent.setup({ applyAccept: false });
    render(<ImageUpload file={null} onChange={onChange} />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    const file = makeFile("bag.bmp", "image/bmp");
    await user.upload(input, file);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported format/i);
  });

  it("rejects a file that is too large and shows error", async () => {
    const onChange = vi.fn();
    render(<ImageUpload file={null} onChange={onChange} />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    const file = makeFile("big.jpg", "image/jpeg", 11 * 1024 * 1024);
    await userEvent.upload(input, file);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("shows a Remove button when a file is selected", async () => {
    const file = makeFile("bag.jpg", "image/jpeg");
    render(<ImageUpload file={file} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("calls onChange with null when Remove is clicked", async () => {
    const onChange = vi.fn();
    const file = makeFile("bag.jpg", "image/jpeg");
    render(<ImageUpload file={file} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("is disabled when disabled=true", () => {
    render(<ImageUpload file={null} onChange={vi.fn()} disabled />);
    const input = screen.getByLabelText(/choose a coffee bag photo/i);
    expect(input).toBeDisabled();
  });
});
