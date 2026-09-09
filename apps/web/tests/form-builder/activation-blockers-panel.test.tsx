/**
 * The "before this can go live" checklist.
 *
 * The bug: the panel rendered only while the form was NOT active. That was
 * right when a draft was the only publishable thing, but "Publish changes"
 * later made a live form publishable too — and its refusals went into a panel
 * hidden precisely because the form was live. The toast still said "See the
 * list on the page" and there was no list, so an admin fixing a live form was
 * told nothing at all.
 *
 * Haider hit exactly this: a live form missing its `last_name` question, whose
 * candidates dead-ended on the final step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivationBlockers } from "@/features/form-builder/builder/components/activation-blockers";

afterEach(cleanup);

const SERVER_MESSAGE =
  "This form must ask for a last name — a candidate record cannot be created without one.";

describe("activation blockers panel", () => {
  it("shows a live form's publish refusal — the reported bug", () => {
    render(
      <ActivationBlockers
        blockers={[]}
        serverBlockers={[SERVER_MESSAGE]}
        isActive
        hasDraft
      />,
    );
    expect(screen.getByText(SERVER_MESSAGE)).toBeInTheDocument();
  });

  it("titles it for changes, not the whole form, when the form is already live", () => {
    render(
      <ActivationBlockers
        blockers={[]}
        serverBlockers={[SERVER_MESSAGE]}
        isActive
        hasDraft
      />,
    );
    expect(
      screen.getByRole("heading", { name: /before these changes can go live/i }),
    ).toBeInTheDocument();
  });

  it("still shows for a draft form, as it always did", () => {
    render(
      <ActivationBlockers
        blockers={[{ id: "email", message: "Add an email question." }]}
        serverBlockers={[]}
        isActive={false}
        hasDraft
      />,
    );
    expect(screen.getByText("Add an email question.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /before this form can go live/i }),
    ).toBeInTheDocument();
  });

  it("stays silent on a live form with nothing waiting to publish", () => {
    // That form already passed the gate; there is nothing to warn about.
    render(
      <ActivationBlockers
        blockers={[{ id: "email", message: "Add an email question." }]}
        serverBlockers={[SERVER_MESSAGE]}
        isActive
        hasDraft={false}
      />,
    );
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText("Add an email question.")).not.toBeInTheDocument();
  });

  it("stays silent when there is nothing to report", () => {
    const { container } = render(
      <ActivationBlockers
        blockers={[]}
        serverBlockers={[]}
        isActive={false}
        hasDraft
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a one-click fix only where the builder has one", async () => {
    const fix = vi.fn();
    render(
      <ActivationBlockers
        blockers={[
          { id: "email", message: "Add an email question.", fix },
          { id: "role", message: "Choose a role." },
        ]}
        serverBlockers={[]}
        isActive={false}
        hasDraft
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /add it now/i });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(fix).toHaveBeenCalledOnce();
  });
});
