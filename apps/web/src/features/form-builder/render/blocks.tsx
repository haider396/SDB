/**
 * Non-question content blocks: headings, paragraphs, dividers, spacers, images.
 *
 * Deliberately dependency-free — this module is reachable from the PUBLIC
 * entry chunk, so it must never pull in dnd-kit, TanStack Table or Recharts
 * (see the no-restricted-imports boundary in eslint.config.js).
 */
import type { FormBlock } from "@sdb/contracts";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { cn } from "@/lib/utils";
import { ALIGN_CLASS, FONT_SIZE_CLASS } from "./styled-field";

const HEADING_DEFAULT_SIZE: Record<number, string> = {
  1: "text-3xl",
  2: "text-2xl",
  3: "text-xl",
  4: "text-lg",
};

export function ContentBlock({ block }: { block: FormBlock }) {
  const align = block.style.align ?? "left";
  const alignClass = ALIGN_CLASS[align] ?? "text-left";
  const sizeClass =
    block.style.fontSize !== undefined
      ? FONT_SIZE_CLASS[block.style.fontSize]
      : undefined;
  const weightClass =
    block.style.fontWeight === "700"
      ? "font-bold"
      : block.style.fontWeight === "600"
        ? "font-semibold"
        : block.style.fontWeight === "500"
          ? "font-medium"
          : undefined;

  switch (block.blockType) {
    case "heading": {
      const level = block.props.level ?? 2;
      const Tag = (`h${String(level)}` as "h1" | "h2" | "h3" | "h4");
      return (
        <Tag
          className={cn(
            "sdb-block-heading",
            sizeClass ?? HEADING_DEFAULT_SIZE[level] ?? "text-2xl",
            weightClass,
            alignClass,
          )}
        >
          {block.props.text ?? ""}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <div
          className={cn(
            "sdb-block-paragraph",
            sizeClass ?? "text-sm",
            weightClass,
            alignClass,
          )}
        >
          <SimpleMarkdown source={block.props.text ?? ""} />
        </div>
      );
    case "divider":
      return <hr className="sdb-block-divider" />;
    case "spacer":
      // Height comes from the block's row span; nothing to draw.
      return <div aria-hidden="true" />;
    case "image":
      return block.props.storagePath === undefined ? null : (
        <img
          src={block.props.storagePath}
          alt={block.props.altText ?? ""}
          className="max-w-full rounded-md"
        />
      );
    default:
      return null;
  }
}

/** Block types that render content rather than collecting an answer. */
export const CONTENT_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "divider",
  "spacer",
  "image",
]);
