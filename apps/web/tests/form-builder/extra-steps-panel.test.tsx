/**
 * The builder's "Extra steps" panel.
 *
 * The bug it closes: `hasTypingTest` / `hasDocumentsStep` were supported by the
 * database, the repository, the contracts, the PATCH route and the public
 * renderer — and set by nothing in the admin UI. Every form built in the
 * builder therefore went live with both off, and no admin could change it, so
 * candidates were never asked for a CV and never took the typing test.
 *
 * What is worth pinning:
 *   - both boxes reflect the form's current flags
 *   - ticking one sends ONLY that flag, so the other cannot be clobbered
 *   - unticking sends `false` rather than omitting the key (a PATCH that
 *     omits it means "unchanged" — the flag would never turn off)
 *   - a live form warns that the change is immediate, a draft does not
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtraStepsPanel } from "@/features/form-builder/builder/components/extra-steps-panel";

afterEach(cleanup);

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ExtraStepsPanel>> = {},
) {
  const onChange = vi.fn().mockResolvedValue({});
  render(
    <ExtraStepsPanel
      hasTypingTest={false}
      hasDocumentsStep={false}
      isSaving={false}
      isLive={false}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

const typing = () => screen.getByRole("checkbox", { name: /typing speed test/i });
const documents = () => screen.getByRole("checkbox", { name: /documents/i });

describe("extra steps panel", () => {
  it("reflects the form's current flags", () => {
    renderPanel({ hasTypingTest: true, hasDocumentsStep: false });
    expect(typing()).toBeChecked();
    expect(documents()).not.toBeChecked();
  });

  it("sends only the flag that was ticked", async () => {
    const { onChange } = renderPanel({ hasDocumentsStep: true });
    await userEvent.click(typing());
    // Not `{hasTypingTest: true, hasDocumentsStep: true}` — sending both would
    // overwrite a value another admin changed between load and click.
    expect(onChange).toHaveBeenCalledWith({ hasTypingTest: true });
  });

  it("sends false when unticking, rather than omitting the key", async () => {
    // PATCH treats an absent key as "leave alone" (repo uses coalesce), so an
    // omitted flag could never be switched off.
    const { onChange } = renderPanel({ hasDocumentsStep: true });
    await userEvent.click(documents());
    expect(onChange).toHaveBeenCalledWith({ hasDocumentsStep: false });
  });

  it("warns that a change to a live form is immediate", () => {
    renderPanel({ isLive: true });
    expect(screen.getByText(/applies straight away/i)).toBeInTheDocument();
  });

  it("does not warn on a form that is not live", () => {
    renderPanel({ isLive: false });
    expect(screen.queryByText(/applies straight away/i)).not.toBeInTheDocument();
  });

  it("disables both boxes while a save is in flight", () => {
    renderPanel({ isSaving: true });
    expect(typing()).toBeDisabled();
    expect(documents()).toBeDisabled();
  });
});
