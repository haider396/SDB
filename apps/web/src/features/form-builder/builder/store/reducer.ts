/**
 * The builder document — a PURE reducer, directly unit-tested.
 *
 * Not Zustand: 05-FRONTEND §1 restricts Zustand to cross-cutting UI state and
 * explicitly not to data. A form document is neither server state nor
 * cross-cutting UI state; it is local document state with a transactional
 * history, which is exactly what useReducer is for — and it makes undo/redo
 * fall out for free.
 *
 * ⚠ Transient gesture state (a drag in flight, a resize preview) must NOT be
 * dispatched here. dnd-kit's transform is component-local and the resize hook
 * writes inline style through a ref; ONE dispatch happens on pointer-up. A
 * dispatch per pointermove re-runs this reducer and re-renders every node
 * 60×/sec, which is unusable on a form of any size.
 */
import type { CanvasRect, FormBlock, FormDocument, FormTheme } from "@sdb/contracts";
import { moveRect, resizeRect, restack, type ResizeEdge, type ZDirection } from "../../geometry";

export interface BuilderState {
  past: FormDocument[];
  present: FormDocument;
  future: FormDocument[];
  selectedIds: readonly string[];
  activePageIndex: number;
  /** Hash of the last saved document, so `isDirty` is a comparison not a flag. */
  savedHash: string;
  /** Coalescing window: `${type}:${id}` and when it last fired. */
  lastCoalesceKey: string | null;
  lastCoalesceAt: number;
}

export type BuilderAction =
  | { type: "ADD_BLOCK"; block: FormBlock }
  | { type: "DELETE_BLOCKS"; ids: readonly string[] }
  | { type: "DUPLICATE_BLOCKS"; ids: readonly string[]; newIds: readonly string[] }
  | { type: "MOVE_BLOCKS"; ids: readonly string[]; deltaCols: number; deltaRows: number }
  | { type: "RESIZE_BLOCK"; id: string; edge: ResizeEdge; deltaCols: number; deltaRows: number }
  | { type: "SET_RECT"; id: string; rect: Partial<CanvasRect> }
  | { type: "SET_MOBILE_RECT"; id: string; rect: CanvasRect | null }
  | { type: "RESTACK"; id: string; direction: ZDirection }
  | { type: "SET_BLOCK_STYLE"; id: string; patch: FormBlock["style"] }
  | { type: "SET_BLOCK_PROPS"; id: string; patch: FormBlock["props"] }
  | { type: "SET_REQUIRED_OVERRIDE"; id: string; value: boolean | null }
  | {
      type: "SET_CONTENT_OVERRIDE";
      id: string;
      patch: Partial<
        Pick<
          FormBlock,
          | "labelOverride"
          | "placeholderOverride"
          | "helpTextOverride"
          | "optionValueOverrides"
        >
      >;
    }
  | { type: "SET_THEME"; patch: Partial<FormTheme> }
  | { type: "SET_PAGES"; pages: FormDocument["pages"] }
  | { type: "ADD_PAGE"; title: string }
  | { type: "RENAME_PAGE"; index: number; title: string; description: string | null }
  | { type: "DELETE_PAGE"; index: number }
  | { type: "SELECT"; ids: readonly string[] }
  | { type: "SET_PAGE"; pageIndex: number }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "MARK_SAVED"; document: FormDocument };

/** Cheap structural hash — only ever compared to itself. */
export function hashDocument(document: FormDocument): string {
  return JSON.stringify(document);
}

const HISTORY_LIMIT = 50;
/**
 * Dragging a stepper from 0 to 24 must be ONE undo step, not 24. Any two
 * consecutive actions with the same type+target inside this window collapse.
 */
const COALESCE_MS = 500;

const COALESCING_ACTIONS = new Set([
  "SET_RECT",
  "SET_MOBILE_RECT",
  "SET_BLOCK_STYLE",
  "SET_BLOCK_PROPS",
  "SET_THEME",
  "SET_CONTENT_OVERRIDE",
]);

function coalesceKey(action: BuilderAction): string | null {
  if (!COALESCING_ACTIONS.has(action.type)) return null;
  const id = "id" in action ? action.id : "form";
  return `${action.type}:${id}`;
}

export function initialState(
  document: FormDocument,
  activePageIndex = 0,
): BuilderState {
  return {
    past: [],
    present: document,
    future: [],
    selectedIds: [],
    activePageIndex,
    savedHash: hashDocument(document),
    lastCoalesceKey: null,
    lastCoalesceAt: 0,
  };
}

export function isDirty(state: BuilderState): boolean {
  return hashDocument(state.present) !== state.savedHash;
}

function mapBlock(
  document: FormDocument,
  id: string,
  fn: (block: FormBlock) => FormBlock,
): FormDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => (block.id === id ? fn(block) : block)),
  };
}

/** Apply the action to the document. History is handled by the caller. */
function applyAction(
  document: FormDocument,
  action: BuilderAction,
): FormDocument {
  switch (action.type) {
    case "ADD_BLOCK":
      return { ...document, blocks: [...document.blocks, action.block] };

    case "DELETE_BLOCKS": {
      const doomed = new Set(action.ids);
      return {
        ...document,
        blocks: document.blocks.filter((block) => !doomed.has(block.id)),
      };
    }

    case "DUPLICATE_BLOCKS": {
      const copies: FormBlock[] = [];
      action.ids.forEach((id, index) => {
        const source = document.blocks.find((block) => block.id === id);
        const newId = action.newIds[index];
        if (source === undefined || newId === undefined) return;
        copies.push({
          ...source,
          id: newId,
          // A duplicate lands below the original rather than exactly on top.
          layout: {
            ...source.layout,
            desktop: moveRect(source.layout.desktop, 0, source.layout.desktop.rowSpan + 2),
          },
          // Two blocks may never reference the same question on one version
          // (uq_form_blocks_question), so a duplicated question block becomes
          // a content-free copy the admin must re-point.
          questionId: null,
          blockType: source.blockType === "question" ? "spacer" : source.blockType,
        });
      });
      return { ...document, blocks: [...document.blocks, ...copies] };
    }

    case "MOVE_BLOCKS": {
      const moving = new Set(action.ids);
      return {
        ...document,
        blocks: document.blocks.map((block) =>
          moving.has(block.id)
            ? {
                ...block,
                layout: {
                  ...block.layout,
                  desktop: moveRect(
                    block.layout.desktop,
                    action.deltaCols,
                    action.deltaRows,
                  ),
                },
              }
            : block,
        ),
      };
    }

    case "RESIZE_BLOCK":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        layout: {
          ...block.layout,
          desktop: resizeRect(
            block.layout.desktop,
            action.edge,
            action.deltaCols,
            action.deltaRows,
          ),
        },
      }));

    case "SET_RECT":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        layout: {
          ...block.layout,
          desktop: { ...block.layout.desktop, ...action.rect },
        },
      }));

    case "SET_MOBILE_RECT":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        layout: { ...block.layout, mobile: action.rect },
      }));

    case "RESTACK": {
      const zByIdMap = restack(document.blocks, action.id, action.direction);
      return {
        ...document,
        blocks: document.blocks.map((block) => ({
          ...block,
          layout: {
            ...block.layout,
            desktop: {
              ...block.layout.desktop,
              z: zByIdMap.get(block.id) ?? block.layout.desktop.z,
            },
          },
        })),
      };
    }

    case "SET_BLOCK_STYLE":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        style: { ...block.style, ...action.patch },
      }));

    case "SET_BLOCK_PROPS":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        props: { ...block.props, ...action.patch },
      }));

    case "SET_REQUIRED_OVERRIDE":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        isRequiredOverride: action.value,
      }));

    case "SET_CONTENT_OVERRIDE":
      return mapBlock(document, action.id, (block) => ({
        ...block,
        ...action.patch,
      }));

    case "SET_THEME":
      return { ...document, theme: { ...document.theme, ...action.patch } };

    case "SET_PAGES":
      return { ...document, pages: action.pages };

    case "ADD_PAGE":
      return {
        ...document,
        pages: [
          ...document.pages,
          { index: document.pages.length, title: action.title, description: null },
        ],
      };

    case "RENAME_PAGE":
      return {
        ...document,
        pages: document.pages.map((page) =>
          page.index === action.index
            ? { ...page, title: action.title, description: action.description }
            : page,
        ),
      };

    case "DELETE_PAGE": {
      // A step owns its blocks — removing it must remove them too, or they
      // become orphans that render nowhere and block nothing.
      const remaining = document.pages.filter((page) => page.index !== action.index);
      // Re-index so the sequence stays 0..n-1: page index IS the ordering, and
      // a gap would leave a step unreachable.
      const reindexed = remaining.map((page, position) => ({
        ...page,
        index: position,
      }));
      const oldToNew = new Map(
        remaining.map((page, position) => [page.index, position]),
      );
      return {
        ...document,
        pages: reindexed,
        blocks: document.blocks
          .filter((block) => block.pageIndex !== action.index)
          .map((block) => ({
            ...block,
            pageIndex: oldToNew.get(block.pageIndex) ?? block.pageIndex,
          })),
      };
    }

    default:
      return document;
  }
}

export function builderReducer(
  state: BuilderState,
  action: BuilderAction,
): BuilderState {
  switch (action.type) {
    case "SELECT":
      return { ...state, selectedIds: action.ids };

    case "SET_PAGE":
      return { ...state, activePageIndex: action.pageIndex, selectedIds: [] };

    case "UNDO": {
      const previous = state.past.at(-1);
      if (previous === undefined) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        // Undoing a delete should re-select what came back.
        selectedIds: state.selectedIds.filter((id) =>
          previous.blocks.some((block) => block.id === id),
        ),
        lastCoalesceKey: null,
      };
    }

    case "REDO": {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        lastCoalesceKey: null,
      };
    }

    case "MARK_SAVED":
      return {
        ...state,
        present: action.document,
        savedHash: hashDocument(action.document),
      };

    default: {
      const next = applyAction(state.present, action);
      if (next === state.present) return state;

      const key = coalesceKey(action);
      const now = Date.now();
      const shouldCoalesce =
        key !== null &&
        key === state.lastCoalesceKey &&
        now - state.lastCoalesceAt < COALESCE_MS &&
        state.past.length > 0;

      const past = shouldCoalesce
        ? state.past
        : [...state.past, state.present].slice(-HISTORY_LIMIT);

      return {
        ...state,
        past,
        present: next,
        // Any new edit invalidates the redo branch.
        future: [],
        lastCoalesceKey: key,
        lastCoalesceAt: now,
        selectedIds:
          action.type === "ADD_BLOCK"
            ? [action.block.id]
            : action.type === "DELETE_BLOCKS"
              ? []
              : state.selectedIds,
      };
    }
  }
}
