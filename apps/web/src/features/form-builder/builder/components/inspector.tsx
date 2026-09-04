/**
 * The right-hand inspector: Content, Style and Position for the selection, or
 * whole-form settings when nothing is selected.
 *
 * ── The Position panel is the AC-UI-04 fallback ─────────────────────────────
 * A free canvas is a gesture surface, so it needs a real non-gesture
 * equivalent — not a token one. These four steppers and four z-order buttons
 * do exactly what dragging does, in the same spirit as the Move up / Move down
 * buttons beside the drag handle in sortable-list.tsx.
 */
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  CANVAS_COLUMNS,
  MIN_COL_SPAN,
  MIN_ROW_SPAN,
  type FormBlock,
  type FormColorToken,
  type FormTheme,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericStepper } from "@/components/ui/numeric-stepper";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ROW, MAX_ROW_SPAN } from "../../geometry";
import type { BuilderAction } from "../store/reducer";
import { ColorTokenPicker } from "./color-token-picker";
import { QuestionLibraryPanel } from "./question-library-panel";

const SECTION = "space-y-3 border-t border-neutral-200 pt-4 first:border-0 first:pt-0";
const HEADING = "text-2xs font-semibold uppercase tracking-wide text-neutral-500";

/** What the inspector needs to know about the block's library question. */
export interface InspectorQuestion {
  label: string;
  placeholder: string | null;
  helpText: string | null;
  questionType: string;
  options: { value: string; label: string }[];
}

export interface InspectorProps {
  block: FormBlock | null;
  theme: FormTheme;
  dispatch: (action: BuilderAction) => void;
  /** Null while the question library is still loading. */
  question: InspectorQuestion | null;
}

export function Inspector({ block, theme, dispatch, question }: InspectorProps) {
  if (block === null) return <FormSettings theme={theme} dispatch={dispatch} />;
  return (
    <div className="space-y-4">
      <ContentPanel block={block} dispatch={dispatch} question={question} />
      {/* Sits directly under the per-form overrides on purpose, and looks
          different on purpose: everything above is local and undoable, and
          everything inside this panel saves immediately for every form. */}
      {block.blockType === "question" && block.questionId !== null ? (
        <QuestionLibraryPanel questionId={block.questionId} />
      ) : null}
      <StylePanel block={block} dispatch={dispatch} />
      <PositionPanel block={block} dispatch={dispatch} />
    </div>
  );
}

function FormSettings({
  theme,
  dispatch,
}: {
  theme: FormTheme;
  dispatch: (action: BuilderAction) => void;
}) {
  return (
    <div className="space-y-4">
      <section className={SECTION}>
        <h3 className={HEADING}>Form</h3>
        <ColorTokenPicker
          id="theme-page-bg"
          label="Page background"
          value={theme.pageBackground as FormColorToken}
          onChange={(token) => dispatch({ type: "SET_THEME", patch: { pageBackground: token } })}
        />
        <NumericStepper
          id="theme-max-width"
          label="Content width"
          value={theme.maxWidthPx}
          min={480}
          max={1600}
          step={20}
          onChange={(value) => dispatch({ type: "SET_THEME", patch: { maxWidthPx: value } })}
        />
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>Form padding</h3>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <NumericStepper
              key={side}
              id={`theme-pad-${side}`}
              label={side[0]!.toUpperCase() + side.slice(1)}
              value={theme.padding[side]}
              max={200}
              onChange={(value) =>
                dispatch({
                  type: "SET_THEME",
                  patch: { padding: { ...theme.padding, [side]: value } },
                })
              }
            />
          ))}
        </div>
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>Branding</h3>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={theme.showLogo}
            onChange={(event) =>
              dispatch({ type: "SET_THEME", patch: { showLogo: event.target.checked } })
            }
          />
          Show the SDB logo
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={theme.showBrandGradientBar}
            onChange={(event) =>
              dispatch({
                type: "SET_THEME",
                patch: { showBrandGradientBar: event.target.checked },
              })
            }
          />
          Show the brand strip
        </label>
      </section>
    </div>
  );
}

function ContentPanel({
  block,
  dispatch,
  question,
}: {
  block: FormBlock;
  dispatch: (action: BuilderAction) => void;
  question: InspectorQuestion | null;
}) {
  return (
    <section className={SECTION}>
      <h3 className={HEADING}>Content</h3>
      {block.blockType === "question" ? (
        <QuestionContentFields
          block={block}
          dispatch={dispatch}
          question={question}
        />
      ) : block.blockType === "heading" || block.blockType === "paragraph" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`text-${block.id}`}>Text</Label>
          {block.blockType === "heading" ? (
            <Input
              id={`text-${block.id}`}
              value={block.props.text ?? ""}
              onChange={(event) =>
                dispatch({
                  type: "SET_BLOCK_PROPS",
                  id: block.id,
                  patch: { text: event.target.value },
                })
              }
            />
          ) : (
            <Textarea
              id={`text-${block.id}`}
              value={block.props.text ?? ""}
              onChange={(event) =>
                dispatch({
                  type: "SET_BLOCK_PROPS",
                  id: block.id,
                  patch: { text: event.target.value },
                })
              }
            />
          )}
        </div>
      ) : (
        <p className="text-2xs text-neutral-500">
          This block has no content of its own.
        </p>
      )}
    </section>
  );
}

function StylePanel({
  block,
  dispatch,
}: {
  block: FormBlock;
  dispatch: (action: BuilderAction) => void;
}) {
  const style = block.style;
  const set = (patch: FormBlock["style"]) =>
    dispatch({ type: "SET_BLOCK_STYLE", id: block.id, patch });
  const padding = style.padding ?? { top: 4, right: 12, bottom: 4, left: 12 };
  const shadow = style.shadow ?? null;

  return (
    <section className={SECTION}>
      <h3 className={HEADING}>Style</h3>

      <ColorTokenPicker
        id={`text-color-${block.id}`}
        label="Font colour"
        value={style.textColorToken}
        onChange={(token) => set({ textColorToken: token })}
      />
      <ColorTokenPicker
        id={`bg-color-${block.id}`}
        label="Background"
        value={style.backgroundColorToken as FormColorToken | undefined}
        onChange={(token) => set({ backgroundColorToken: token })}
      />
      <ColorTokenPicker
        id={`border-color-${block.id}`}
        label="Border colour"
        value={style.borderColorToken}
        onChange={(token) => set({ borderColorToken: token })}
      />

      <div className="grid grid-cols-2 gap-2">
        <NumericStepper
          id={`border-width-${block.id}`}
          label="Border width"
          value={style.borderWidth ?? 1}
          max={24}
          onChange={(value) => set({ borderWidth: value })}
        />
        <NumericStepper
          id={`radius-${block.id}`}
          label="Corner radius"
          value={style.cornerRadius ?? 6}
          max={200}
          onChange={(value) => set({ cornerRadius: value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`border-style-${block.id}`}>Border style</Label>
        <NativeSelect
          id={`border-style-${block.id}`}
          value={style.borderStyle ?? "solid"}
          onChange={(event) =>
            set({ borderStyle: event.target.value as "solid" | "dashed" | "dotted" | "none" })
          }
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="none">None</option>
        </NativeSelect>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-neutral-600">Padding</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <NumericStepper
              key={side}
              id={`pad-${side}-${block.id}`}
              label={side[0]!.toUpperCase() + side.slice(1)}
              value={padding[side]}
              max={200}
              onChange={(value) => set({ padding: { ...padding, [side]: value } })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-neutral-600">Shadow</legend>
        <label className="flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={shadow !== null}
            onChange={(event) =>
              set({
                shadow: event.target.checked
                  ? {
                      colorToken: "neutral-300",
                      offsetX: 0,
                      offsetY: 2,
                      blur: 6,
                      spread: 0,
                    }
                  : null,
              })
            }
          />
          Drop shadow
        </label>
        {shadow !== null ? (
          <>
            <ColorTokenPicker
              id={`shadow-color-${block.id}`}
              label="Shadow colour"
              value={shadow.colorToken}
              onChange={(token) => set({ shadow: { ...shadow, colorToken: token } })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumericStepper
                id={`shadow-x-${block.id}`}
                label="Horizontal"
                value={shadow.offsetX}
                min={-64}
                max={64}
                onChange={(value) => set({ shadow: { ...shadow, offsetX: value } })}
              />
              <NumericStepper
                id={`shadow-y-${block.id}`}
                label="Vertical"
                value={shadow.offsetY}
                min={-64}
                max={64}
                onChange={(value) => set({ shadow: { ...shadow, offsetY: value } })}
              />
              <NumericStepper
                id={`shadow-blur-${block.id}`}
                label="Blur"
                value={shadow.blur}
                max={128}
                onChange={(value) => set({ shadow: { ...shadow, blur: value } })}
              />
              <NumericStepper
                id={`shadow-spread-${block.id}`}
                label="Spread"
                value={shadow.spread}
                min={-64}
                max={64}
                onChange={(value) => set({ shadow: { ...shadow, spread: value } })}
              />
            </div>
          </>
        ) : null}
      </fieldset>
    </section>
  );
}

/** The keyboard equivalent of dragging and resizing (AC-UI-04). */
function PositionPanel({
  block,
  dispatch,
}: {
  block: FormBlock;
  dispatch: (action: BuilderAction) => void;
}) {
  const rect = block.layout.desktop;
  const setRect = (patch: Partial<typeof rect>) =>
    dispatch({ type: "SET_RECT", id: block.id, rect: patch });

  return (
    <section className={SECTION}>
      <h3 className={HEADING}>Position</h3>
      <p className="text-2xs text-neutral-500">
        The same result as dragging — for anyone not using a mouse.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <NumericStepper
          id={`pos-col-${block.id}`}
          label="Column"
          unit=""
          value={rect.col + 1}
          min={1}
          max={CANVAS_COLUMNS - rect.colSpan + 1}
          onChange={(value) => setRect({ col: value - 1 })}
        />
        <NumericStepper
          id={`pos-row-${block.id}`}
          label="Row"
          unit=""
          value={rect.row + 1}
          min={1}
          max={MAX_ROW}
          onChange={(value) => setRect({ row: value - 1 })}
        />
        <NumericStepper
          id={`pos-width-${block.id}`}
          label="Width"
          unit="col"
          value={rect.colSpan}
          min={MIN_COL_SPAN}
          max={CANVAS_COLUMNS - rect.col}
          onChange={(value) => setRect({ colSpan: value })}
        />
        <NumericStepper
          id={`pos-height-${block.id}`}
          label="Height"
          unit="row"
          value={rect.rowSpan}
          min={MIN_ROW_SPAN}
          max={MAX_ROW_SPAN}
          onChange={(value) => setRect({ rowSpan: value })}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "RESTACK", id: block.id, direction: "front" })}
        >
          <ArrowUpToLine className="mr-1 h-3 w-3" aria-hidden="true" />
          Front
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "RESTACK", id: block.id, direction: "forward" })}
        >
          <ChevronUp className="mr-1 h-3 w-3" aria-hidden="true" />
          Forward
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "RESTACK", id: block.id, direction: "backward" })}
        >
          <ChevronDown className="mr-1 h-3 w-3" aria-hidden="true" />
          Back
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "RESTACK", id: block.id, direction: "back" })}
        >
          <ArrowDownToLine className="mr-1 h-3 w-3" aria-hidden="true" />
          Bottom
        </Button>
      </div>
    </section>
  );
}


/**
 * Per-form wording and choices.
 *
 * These are OVERRIDES, not copies: leaving a field blank falls back to the
 * question library, so renaming a question there still reaches every form that
 * has not deliberately said otherwise. The override is applied server-side
 * before the answer is validated, which is why it also ends up in the
 * question_snapshot — the record says what this candidate actually saw.
 *
 * Type is absent on purpose. It decides which column an answer is stored in, so
 * it belongs to the question, not to one form's copy of it. Add a different
 * field if you need a different kind of answer.
 */
function QuestionContentFields({
  block,
  dispatch,
  question,
}: {
  block: FormBlock;
  dispatch: (action: BuilderAction) => void;
  question: InspectorQuestion | null;
}) {
  const override = (
    patch: Partial<
      Pick<
        FormBlock,
        | "labelOverride"
        | "placeholderOverride"
        | "helpTextOverride"
        | "optionValueOverrides"
      >
    >,
  ) => dispatch({ type: "SET_CONTENT_OVERRIDE", id: block.id, patch });

  const shownValues =
    block.optionValueOverrides ?? question?.options.map((option) => option.value) ?? [];

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`label-${block.id}`}>Field name</Label>
        <Input
          id={`label-${block.id}`}
          value={block.labelOverride ?? ""}
          placeholder={question?.label ?? "Loading…"}
          onChange={(event) =>
            override({
              labelOverride: event.target.value === "" ? null : event.target.value,
            })
          }
        />
        <p className="text-2xs text-neutral-500">
          Leave empty to use the library wording.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`placeholder-${block.id}`}>Hint inside the box</Label>
        <Input
          id={`placeholder-${block.id}`}
          value={block.placeholderOverride ?? ""}
          placeholder={question?.placeholder ?? "None"}
          onChange={(event) =>
            override({
              placeholderOverride:
                event.target.value === "" ? null : event.target.value,
            })
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`help-${block.id}`}>Help text</Label>
        <Textarea
          id={`help-${block.id}`}
          value={block.helpTextOverride ?? ""}
          placeholder={question?.helpText ?? "None"}
          onChange={(event) =>
            override({
              helpTextOverride: event.target.value === "" ? null : event.target.value,
            })
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`req-${block.id}`}>Required on this form</Label>
        <NativeSelect
          id={`req-${block.id}`}
          value={
            block.isRequiredOverride === null
              ? "inherit"
              : block.isRequiredOverride
                ? "yes"
                : "no"
          }
          onChange={(event) =>
            dispatch({
              type: "SET_REQUIRED_OVERRIDE",
              id: block.id,
              value:
                event.target.value === "inherit" ? null : event.target.value === "yes",
            })
          }
        >
          <option value="inherit">Use the library default</option>
          <option value="yes">Required</option>
          <option value="no">Optional</option>
        </NativeSelect>
      </div>

      {question !== null && question.options.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-neutral-600">
            Choices shown on this form
          </legend>
          <p className="text-2xs text-neutral-500">
            Untick to hide a choice here. Adding a brand-new choice is a change to
            the question itself, so it belongs in the question library.
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-neutral-200 p-2">
            {question.options.map((option) => {
              const shown = shownValues.includes(option.value);
              return (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-xs text-neutral-700"
                >
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...shownValues, option.value]
                        : shownValues.filter((value) => value !== option.value);
                      // All of them ticked = no override at all, so a later
                      // change to the question's choices still flows through.
                      override({
                        optionValueOverrides:
                          next.length === question.options.length ? null : next,
                      });
                    }}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {block.optionValueOverrides !== null ? (
            <button
              type="button"
              className="text-2xs text-brand-blue underline"
              onClick={() => override({ optionValueOverrides: null })}
            >
              Show all choices
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </>
  );
}
