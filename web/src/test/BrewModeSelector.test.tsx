import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BrewModeSelector from "../components/BrewModeSelector.js";

describe("BrewModeSelector", () => {
  it("renders Cold and Hot radio options", () => {
    render(<BrewModeSelector value="cold" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Cold" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Hot" })).toBeInTheDocument();
  });

  it("Cold is selected by default when value=cold", () => {
    render(<BrewModeSelector value="cold" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Cold" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hot" })).not.toBeChecked();
  });

  it("Hot is selected when value=hot", () => {
    render(<BrewModeSelector value="hot" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Hot" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Cold" })).not.toBeChecked();
  });

  it("calls onChange with 'hot' when user clicks Hot", async () => {
    const onChange = vi.fn();
    render(<BrewModeSelector value="cold" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hot" }));
    expect(onChange).toHaveBeenCalledWith("hot");
  });

  it("calls onChange with 'cold' when user clicks Cold", async () => {
    const onChange = vi.fn();
    render(<BrewModeSelector value="hot" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Cold" }));
    expect(onChange).toHaveBeenCalledWith("cold");
  });

  it("radios are disabled when disabled=true", () => {
    render(<BrewModeSelector value="cold" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("radio", { name: "Cold" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Hot" })).toBeDisabled();
  });

  it("has radiogroup role for accessibility", () => {
    render(<BrewModeSelector value="cold" onChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: /brew mode/i })).toBeInTheDocument();
  });
});
