/**
 * Tiny, safe markdown renderer shared by the admin brief preview and the
 * client-portal brief. Deliberately NOT a markdown library: it supports only
 * #/##/### headings, blank-line paragraphs, `- ` bullet lists, and **bold**.
 * Everything else renders as literal text. Output is built from split lines
 * into React elements — never dangerouslySetInnerHTML — so there is no HTML
 * injection surface by construction.
 */
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; lines: string[] };

const HEADING_PATTERN = /^(#{1,3})\s+(.*)$/;
const BULLET_PATTERN = /^-\s+(.*)$/;

/** Group raw source lines into heading / bullet-list / paragraph blocks. */
export function parseSimpleMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushBullets();
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushBullets();
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
      continue;
    }
    const bullet = BULLET_PATTERN.exec(line.trim());
    if (bullet !== null) {
      flushParagraph();
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flushBullets();
    paragraph.push(line);
  }
  flushParagraph();
  flushBullets();
  return blocks;
}

/** Inline pass: only **bold** is recognised; the rest stays literal text. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let index = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<strong key={`bold-${index}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADING_CLASSES: Record<1 | 2 | 3, string> = {
  1: "text-base font-semibold tracking-tight text-brand-navy-ink",
  2: "text-sm font-semibold tracking-tight text-brand-navy-ink",
  3: "text-sm font-medium text-brand-navy-ink",
};

export interface SimpleMarkdownProps {
  source: string;
  /** Rendered when the source is empty/blank. */
  emptyFallback?: ReactNode;
}

/**
 * Render the markdown subset as React elements. Headings map to h3/h4/h5 so
 * they nest under a card's own h2 title without skipping levels.
 */
export function SimpleMarkdown({ source, emptyFallback = null }: SimpleMarkdownProps) {
  const blocks = parseSimpleMarkdown(source);
  if (blocks.length === 0) return <>{emptyFallback}</>;
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = (
            { 1: "h3", 2: "h4", 3: "h5" } as const satisfies Record<
              1 | 2 | 3,
              "h3" | "h4" | "h5"
            >
          )[block.level];
          return (
            <Tag key={index} className={HEADING_CLASSES[block.level]}>
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.kind === "bullets") {
          return (
            <ul
              key={index}
              className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-800"
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={index}
            className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800"
          >
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? "\n" : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
