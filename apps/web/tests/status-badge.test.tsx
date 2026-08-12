import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/patterns/status-badge";

describe("StatusBadge", () => {
  it("always carries text, not colour alone (AC-UI-03)", () => {
    render(<StatusBadge stage="interview_scheduled" />);
    expect(screen.getByText("Interview scheduled")).toBeInTheDocument();
  });

  it("renders the mapped label for internal stages", () => {
    render(<StatusBadge stage="vetted" />);
    expect(screen.getByText("Vetted")).toBeInTheDocument();
  });

  it("uses semantic token utilities, never brand tokens (05 §3.6)", () => {
    render(<StatusBadge stage="placed" />);
    const badge = screen.getByText("Placed");
    expect(badge.className).toContain("text-success-text");
    expect(badge.className).toContain("bg-success-subtle");
  });
});
