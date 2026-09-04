/**
 * Lay blocks out on the canvas and render each one.
 *
 * Shared by the public form and the builder's preview, so what an admin
 * arranges is literally what a candidate sees. Positioning is entirely CSS
 * (see form-canvas.css): this component only computes the custom properties.
 */
import type { ReactNode } from "react";
import type { FormBlock, IntakeFormQuestion } from "@sdb/contracts";
import { cn } from "@/lib/utils";
import { reflowOrder } from "../geometry";
import { ContentBlock, CONTENT_BLOCK_TYPES } from "./blocks";
import { blockPositionVars, fieldStyleVars } from "./styled-field";

export interface CanvasRendererProps {
  blocks: readonly FormBlock[];
  /** Live questions by id — a block whose question is absent is skipped. */
  questionsById: ReadonlyMap<string, IntakeFormQuestion>;
  /** Renders one question. Supplied so the builder can render a dead preview. */
  renderQuestion: (question: IntakeFormQuestion, block: FormBlock) => ReactNode;
  /** Which page (step) to draw. */
  pageIndex: number;
  /** Editing chrome, wrapped around each node by the builder only. */
  wrapNode?: (block: FormBlock, node: ReactNode) => ReactNode;
  className?: string;
}

export function CanvasRenderer({
  blocks,
  questionsById,
  renderQuestion,
  pageIndex,
  wrapNode,
  className,
}: CanvasRendererProps) {
  const onPage = blocks.filter((block) => block.pageIndex === pageIndex);
  // Order is computed across the WHOLE page so the narrow layout reads in the
  // same sequence the author laid out, top-to-bottom then left-to-right.
  const order = reflowOrder(onPage);

  return (
    <div className={cn("sdb-canvas", className)}>
      {onPage.map((block) => {
        const question =
          block.questionId === null ? null : questionsById.get(block.questionId);
        // A block whose question is no longer live is dropped rather than
        // rendered broken — the API already excludes it from the submit scope.
        if (block.blockType === "question" && (question === undefined || question === null)) {
          return null;
        }
        const inner: ReactNode = CONTENT_BLOCK_TYPES.has(block.blockType) ? (
          <ContentBlock block={block} />
        ) : question !== null && question !== undefined ? (
          renderQuestion(question, block)
        ) : null;

        const node = (
          <div
            key={block.id}
            className="sdb-canvas-node"
            style={{
              ...blockPositionVars(block.layout.desktop, order.get(block.id) ?? 0),
              ...fieldStyleVars(block.style),
            }}
          >
            {wrapNode === undefined ? inner : wrapNode(block, inner)}
          </div>
        );
        return node;
      })}
    </div>
  );
}
