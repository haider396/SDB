/**
 * The shared safe markdown-subset renderer (UX 1.2): #/##/### headings,
 * blank-line paragraphs, - bullets, **bold** — and nothing else. Injection
 * attempts must render as literal text, never as markup.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SimpleMarkdown, parseSimpleMarkdown } from "@/lib/simple-markdown";

afterEach(cleanup);

describe("SimpleMarkdown", () => {
  it("renders #/##/### headings at h3/h4/h5", () => {
    render(
      <SimpleMarkdown source={"# Role\n## Context\n### Detail"} />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Role" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Context" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 5, name: "Detail" }),
    ).toBeInTheDocument();
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const { container } = render(
      <SimpleMarkdown source={"First line\nsecond line\n\nNext paragraph"} />,
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toBe("First line\nsecond line");
    expect(paragraphs[1]?.textContent).toBe("Next paragraph");
  });

  it("renders - lines as a bullet list", () => {
    render(<SimpleMarkdown source={"- One\n- Two\n- Three"} />);
    const list = screen.getByRole("list");
    const items = screen.getAllByRole("listitem");
    expect(list).toBeInTheDocument();
    expect(items.map((item) => item.textContent)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("renders **bold** inline in headings, bullets, and paragraphs", () => {
    const { container } = render(
      <SimpleMarkdown source={"## The **role**\n\n- a **must**\n\nvery **important** indeed"} />,
    );
    const bolds = [...container.querySelectorAll("strong")].map(
      (node) => node.textContent,
    );
    expect(bolds).toEqual(["role", "must", "important"]);
  });

  it("renders an HTML injection attempt as literal text, not markup", () => {
    const { container } = render(
      <SimpleMarkdown
        source={'<img src=x onerror=alert(1)> and <script>alert(2)</script>'}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(
      screen.getByText(/<img src=x onerror=alert\(1\)>/),
    ).toBeInTheDocument();
  });

  it("leaves unsupported markdown (links, code) as literal text", () => {
    render(
      <SimpleMarkdown source={"[link](https://evil.test) and `code`"} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("[link](https://evil.test) and `code`"),
    ).toBeInTheDocument();
  });

  it("renders the empty fallback for blank source", () => {
    render(
      <SimpleMarkdown source={"   \n  "} emptyFallback={<p>Nothing yet.</p>} />,
    );
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("parse: #### is not a heading, it stays a paragraph line", () => {
    const blocks = parseSimpleMarkdown("#### Too deep");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: ["#### Too deep"] },
    ]);
  });
});
