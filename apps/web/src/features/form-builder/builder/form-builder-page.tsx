/**
 * The form builder: palette + layer tree, canvas, inspector.
 *
 * Three panes, mirroring the proven question-manager layout. The canvas IS the
 * preview, so the third pane is the inspector rather than a separate preview.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Eye,
  Monitor,
  Pencil,
  Plus,
  Redo2,
  Save,
  Trash,
  Smartphone,
  Trash2,
  Undo2,
} from "lucide-react";
import type {
  FormBlock,
  FormDocument,
  IntakeFormQuestion,
  Question,
  QuestionDetail,
} from "@sdb/contracts";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { NativeSelect } from "@/components/ui/native-select";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { usePageTitle } from "@/lib/use-page-title";
import { cn } from "@/lib/utils";
import { QuestionField } from "@/features/intake-form/components/question-field";
import {
  questionKeys,
  useAllQuestions,
  useCategories,
  useQuestionDetail,
} from "@/features/question-manager/api";
import { QuestionEditor } from "@/features/question-manager/components/question-editor";
import {
  errorFieldMessages,
  useCreateDraft,
  useDeleteForm,
  useForm,
  useSaveDocument,
  useSetFormStatus,
  useUpdateForm,
} from "../api";
import { fittedRowSpan, tidyBlocks } from "../block-height";
import { CONTENT_BLOCKS, makeBlock, newBlockId } from "../defaults";
import { nextFreeRow } from "../geometry";
import { BuilderCanvas } from "./components/builder-canvas";
import { Inspector } from "./components/inspector";
import { ActivationBlockers } from "./components/activation-blockers";
import { ExtraStepsPanel } from "./components/extra-steps-panel";
import { LayerTree } from "./components/layer-tree";
import { StepBar } from "./components/step-bar";
import { PreviewPane } from "./components/preview-pane";
import {
  builderReducer,
  initialState,
  isDirty,
  type BuilderAction,
} from "./store/reducer";

type Device = "desktop" | "mobile";

/** Email identifies a candidate; no form activates without it (04 §8.3). */
const IDENTITY_KEY = "email";

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  mobile: "390px",
};

export function FormBuilderPage() {
  const { id = "" } = useParams<{ id: string }>();
  const formQuery = useForm(id);
  const questionsQuery = useAllQuestions("candidate");
  usePageTitle("Form builder");

  if (formQuery.isLoading) {
    return <LoadingSkeleton variant="card" rows={5} label="Loading the form…" />;
  }
  if (formQuery.isError || formQuery.data === undefined) {
    return (
      <ErrorState
        error={formQuery.error}
        onRetry={() => void formQuery.refetch()}
        backTo={{ to: "/admin/forms", label: "Forms" }}
      />
    );
  }

  const detail = formQuery.data;
  const version = detail.draftVersion ?? detail.publishedVersion;
  if (version === null || version === undefined) {
    return (
      <ErrorState
        error={new Error("This form has no editable version.")}
        onRetry={() => void formQuery.refetch()}
      />
    );
  }

  return (
    <BuilderInner
      key={version.id}
      formId={id}
      versionId={version.id}
      readOnly={detail.draftVersion === null}
      hasDraft={detail.draftVersion !== null}
      slug={detail.slug}
      label={detail.label}
      status={detail.status}
      publicPath={detail.publicPath}
      hasTypingTest={detail.hasTypingTest}
      hasDocumentsStep={detail.hasDocumentsStep}
      isDefault={detail.isDefault}
      hasRoleCategory={detail.roleCategory !== null}
      document={{
        pages: version.pages,
        theme: version.theme,
        blocks: version.blocks,
      }}
      // ONLY candidate-audience questions — now scoped by the query itself. A
      // client or internal question would be refused at activation (AC-IF-02),
      // so offering one is a trap: the admin would build a form that cannot go
      // live. The isActive filter stays client-side because a deactivated
      // question must still resolve for blocks already placed.
      questions={(questionsQuery.data ?? []).filter((question) => question.isActive)}
    />
  );
}

function BuilderInner({
  formId,
  versionId,
  readOnly,
  hasDraft,
  label,
  status,
  publicPath,
  hasTypingTest,
  hasDocumentsStep,
  isDefault,
  hasRoleCategory,
  document,
  questions,
}: {
  formId: string;
  versionId: string;
  readOnly: boolean;
  /** An unpublished draft exists — on a live form that means changes to publish. */
  hasDraft: boolean;
  slug: string;
  label: string;
  status: "draft" | "active" | "inactive";
  publicPath: string;
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
  isDefault: boolean;
  /** A form must be tied to a role before it can go live, unless it is the default. */
  hasRoleCategory: boolean;
  document: FormDocument;
  questions: Question[];
}) {
  const [state, dispatchAction] = useReducer(builderReducer, initialState(document));
  /*
   * A published version is a read-only VIEW of a live form.
   *
   * Disabling the Save button is not enough on its own: every control — the
   * canvas, the layer tree, the inspector, the keyboard nudges — still edited
   * the document happily, so an admin could rearrange a live form at length and
   * lose the lot on navigation. Guarding the single dispatch is one place to be
   * right, and a control added later cannot slip past it.
   *
   * Selection and paging are not edits, so they still work: reading a published
   * form means clicking through its steps and blocks.
   */
  const warnedReadOnly = useRef(false);
  const dispatch = useCallback(
    (action: BuilderAction) => {
      if (readOnly && action.type !== "SELECT" && action.type !== "SET_PAGE") {
        if (!warnedReadOnly.current) {
          warnedReadOnly.current = true;
          toast.error(
            "This version is published. Turn the form off and start a new draft to change it.",
          );
        }
        return;
      }
      dispatchAction(action);
    },
    [readOnly],
  );

  const [device, setDevice] = useState<Device>("desktop");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [announcement, setAnnouncement] = useState("");
  const inspectorRef = useRef<HTMLElement | null>(null);

  /**
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
   *
   * The toolbar buttons alone are not enough: the block toolbar tells people
   * to press Ctrl+Z after a delete, and a promise the app does not keep is
   * worse than no promise. Nothing is shortcut-ONLY though — every action here
   * also has a visible button (AC-UI-04).
   *
   * Typing in a field is left alone, so the browser's own undo still works
   * inside a text input.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable === true
      ) {
        return;
      }
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "REDO" : "UNDO" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  const queryClient = useQueryClient();
  const candidateCategories = useCategories("candidate");
  const [creatingQuestion, setCreatingQuestion] = useState(false);

  const save = useSaveDocument(formId, versionId);
  const setStatus = useSetFormStatus(formId);
  const remove = useDeleteForm(formId);
  const createDraft = useCreateDraft(formId);
  /**
   * The typing test and documents steps are FORM-level, not part of the
   * versioned document, so they save the moment they are ticked and are not
   * undoable with Ctrl+Z. That is the same split as the question library panel
   * in the inspector, and the panel below says so out loud — two controls that
   * look alike but persist differently is precisely how the last builder bug
   * went unnoticed.
   */
  const updateForm = useUpdateForm(formId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Reasons the SERVER refused — rules the browser cannot check for itself.
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  const navigate = useNavigate();
  const dirty = isDirty(state);

  // One shared blocker per layout — never a second useBlocker.
  useDirtyGuard(dirty);

  /**
   * The builder previews questions from the library. It renders the REAL
   * QuestionField, with the question's real type, choices, validation and
   * required flag, so what an admin arranges is what a candidate sees. Values
   * go nowhere.
   *
   * The choices matter for more than looks. `GET /questions` has always
   * returned them (questions.service.ts `assemble`), but this map used to
   * throw them away and hand every select an empty option list — so a
   * five-choice question previewed as a 36px dropdown while the candidate got
   * a 130px radio group, and the admin could not see the overlap they were
   * building. It is also what block-height.ts measures.
   */
  const questionsById = useMemo(() => {
    const map = new Map<string, IntakeFormQuestion>();
    for (const question of questions) {
      map.set(question.id, {
        id: question.id,
        key: question.key,
        label: question.label,
        helpText: question.helpText,
        placeholder: question.placeholder,
        questionType: question.questionType,
        isRequired: question.isRequired,
        sortOrder: 0,
        validation: question.validation,
        options: question.options
          .filter((option) => option.isActive)
          .map((option) => ({ value: option.value, label: option.label })),
        conditional: null,
      });
    }
    return map;
  }, [questions]);

  /*
   * What still stops this form going live.
   *
   * The server is the authority — it re-checks everything at activate, and can
   * see things the browser cannot (a question deactivated in another tab). But
   * finding out only when you press Activate, from a toast that says nothing
   * more than "not ready", is how an admin ends up staring at a form with no
   * idea what is wrong. These are the checks the browser CAN make, shown while
   * there is still something to do about them.
   *
   * Deliberately mirrors candidate-forms.service.ts's gate. If that gains a
   * rule, this list gets stale rather than wrong: the server still refuses, and
   * its reasons are rendered alongside these.
   */
  const questionBlocks = state.present.blocks.filter(
    (block) => block.blockType === "question" && block.questionId !== null,
  );
  const emailQuestion = questions.find((question) => question.key === IDENTITY_KEY);
  const hasEmailBlock =
    emailQuestion !== undefined &&
    questionBlocks.some((block) => block.questionId === emailQuestion.id);

  const blockers: { id: string; message: string; fix?: () => void }[] = [];
  if (questionBlocks.length === 0) {
    blockers.push({
      id: "blocks",
      message: "Add at least one question before activating.",
    });
  }
  if (!hasEmailBlock) {
    blockers.push({
      id: "email",
      message:
        "This form must ask for an email address — it is how a candidate is identified, and how two applications from one person are recognised as the same candidate.",
      // The question is already in the library; making the admin hunt for it
      // in the picker is a pointless extra step.
      ...(emailQuestion !== undefined && !readOnly
        ? { fix: () => { addQuestion(emailQuestion.id); } }
        : {}),
    });
  }
  if (!isDefault && !hasRoleCategory) {
    blockers.push({
      id: "role",
      message: "Choose the role this form is for.",
    });
  }

  const page = state.present.pages[state.activePageIndex];
  const selected =
    state.selectedIds.length === 1
      ? (state.present.blocks.find((block) => block.id === state.selectedIds[0]) ?? null)
      : null;

  /**
   * The inspector needs each choice's `isActive` flag, which the list response
   * does not carry — it hands the builder only the value and label of the
   * choices a candidate would see. The detail read is what distinguishes a
   * deactivated choice from a live one, and an admin ticking a dead choice
   * would otherwise be silently dropped at render time.
   *
   * Fetched one selection at a time, and cached by TanStack Query, so
   * re-selecting is free.
   */
  const selectedQuestionId =
    selected?.blockType === "question" ? (selected.questionId ?? undefined) : undefined;
  const selectedQuestion = useQuestionDetail(selectedQuestionId);

  const inspectorQuestion = useMemo(() => {
    if (selectedQuestionId === undefined) return null;
    const listed = questionsById.get(selectedQuestionId);
    if (listed === undefined) return null;
    return {
      label: listed.label,
      placeholder: listed.placeholder,
      helpText: listed.helpText,
      questionType: listed.questionType,
      // Deactivated choices are excluded: the server resolves overrides against
      // the question's LIVE options, so ticking a dead one would be silently
      // dropped at render time.
      options: (selectedQuestion.data?.options ?? [])
        .filter((option) => option.isActive)
        .map((option) => ({ value: option.value, label: option.label })),
    };
  }, [selectedQuestionId, questionsById, selectedQuestion.data]);

  /**
   * The canvas gets the selected question's choices from the DETAIL read, so
   * activating or retiring one in the library shows up in the preview straight
   * away. Every other block already has its real choices from the list
   * response — this only overlays the one the inspector is holding open.
   */
  const canvasQuestions = useMemo(() => {
    if (selectedQuestionId === undefined || inspectorQuestion === null) {
      return questionsById;
    }
    const base = questionsById.get(selectedQuestionId);
    if (base === undefined) return questionsById;
    const next = new Map(questionsById);
    next.set(selectedQuestionId, { ...base, options: inspectorQuestion.options });
    return next;
  }, [questionsById, selectedQuestionId, inspectorQuestion]);

  /** A block's required state, honouring the form-scoped override. */
  const requiredFor = (block: FormBlock, question: IntakeFormQuestion): boolean =>
    block.isRequiredOverride ?? question.isRequired;

  /**
   * The block's per-form wording and choices, mirroring what
   * applyBlockOverrides does server-side. Kept in step deliberately: the canvas
   * must show what the candidate will see, and an empty string is a real
   * override rather than "unset".
   */
  const overriddenContent = (
    block: FormBlock,
    question: IntakeFormQuestion,
  ): Partial<IntakeFormQuestion> => {
    const patch: Partial<IntakeFormQuestion> = {};
    if (block.labelOverride !== null) patch.label = block.labelOverride;
    if (block.placeholderOverride !== null) {
      patch.placeholder = block.placeholderOverride;
    }
    if (block.helpTextOverride !== null) patch.helpText = block.helpTextOverride;
    if (block.optionValueOverrides !== null) {
      const shown = new Set(block.optionValueOverrides);
      patch.options = question.options.filter((option) => shown.has(option.value));
    }
    return patch;
  };

  /** The question exactly as this form asks it: library content plus overrides. */
  const effectiveQuestion = (
    block: FormBlock,
    question: IntakeFormQuestion,
  ): IntakeFormQuestion => ({
    ...question,
    ...overriddenContent(block, question),
    isRequired: requiredFor(block, question),
  });

  /** What a block renders, or null while its question is still loading. */
  const resolveQuestion = (block: FormBlock): IntakeFormQuestion | null => {
    if (block.questionId === null) return null;
    const question = canvasQuestions.get(block.questionId);
    return question === undefined ? null : effectiveQuestion(block, question);
  };

  /**
   * Grow a block to fit what it renders.
   *
   * The canvas grid has fixed 8px rows, so a block that outgrows its row span
   * lands on top of the next one rather than pushing it down. Every path that
   * creates a block or changes its content runs through here.
   */
  const fitBlock = (block: FormBlock): FormBlock => {
    const rowSpan = fittedRowSpan(
      block,
      resolveQuestion(block),
      state.present.theme,
    );
    if (rowSpan === block.layout.desktop.rowSpan) return block;
    return {
      ...block,
      layout: {
        ...block.layout,
        desktop: { ...block.layout.desktop, rowSpan },
      },
    };
  };

  /**
   * Rectangles that would change if the layout were tidied — empty when the
   * form is already clean, which is what decides whether to offer the repair.
   *
   * Not memoised: it walks a few dozen blocks, and every input it depends on
   * (the resolver, the overrides) is rebuilt each render anyway, so a useMemo
   * here would promise a stability it cannot deliver.
   */
  const layoutFixes = tidyBlocks(
    state.present.blocks,
    resolveQuestion,
    state.present.theme,
  );

  /**
   * The inspector's dispatch, with auto-fit attached.
   *
   * Adding help text, unticking a choice or typing a longer heading all change
   * how tall a block renders. `fitRowSpan` rides along on the same action so
   * one keystroke stays one undo step and the coalescing window still works —
   * a follow-up SET_RECT would break both.
   */
  const dispatchFitting = (action: BuilderAction) => {
    if (
      action.type !== "SET_CONTENT_OVERRIDE" &&
      action.type !== "SET_BLOCK_PROPS" &&
      action.type !== "SET_BLOCK_STYLE"
    ) {
      dispatch(action);
      return;
    }
    const block = state.present.blocks.find((entry) => entry.id === action.id);
    if (block === undefined) {
      dispatch(action);
      return;
    }
    const patched: FormBlock =
      action.type === "SET_CONTENT_OVERRIDE"
        ? { ...block, ...action.patch }
        : action.type === "SET_BLOCK_PROPS"
          ? { ...block, props: { ...block.props, ...action.patch } }
          : // Style matters here for one control only: a textarea has no fixed
            // height, so the Style panel's padding and border steppers really
            // do make it taller. Everything else is `h-9` and cannot move.
            { ...block, style: { ...block.style, ...action.patch } };
    dispatch({
      ...action,
      fitRowSpan: fittedRowSpan(
        patched,
        resolveQuestion(patched),
        state.present.theme,
      ),
    });
  };

  /**
   * A question created here goes straight onto the canvas.
   *
   * The cache is seeded BEFORE the block is dispatched. Invalidation alone is
   * async, and for the frame or two before the refetch lands the canvas would
   * find no question behind the block: it skips rendering it, the layer tree
   * shows "Question", and the inspector comes up empty. Seeding removes that
   * window entirely.
   */
  // Not memoised: addQuestion is rebuilt each render anyway, so a useCallback
  // here would promise a stability it cannot deliver.
  const handleQuestionCreated = (created: QuestionDetail) => {
    queryClient.setQueryData(questionKeys.detail(created.id), created);
    queryClient.setQueryData<QuestionDetail[]>(
      questionKeys.allQuestionsFor("candidate"),
      (previous) => (previous === undefined ? [created] : [...previous, created]),
    );
    setCreatingQuestion(false);
    addQuestion(created.id);
    toast.success(
      `"${created.label}" added. It also joins your question library, so undo removes it from this form only.`,
    );
  };

  const labelFor = (block: FormBlock): string => {
    if (block.blockType === "question" && block.questionId !== null) {
      return (
        block.labelOverride ??
        questionsById.get(block.questionId)?.label ??
        "Question"
      );
    }
    if (block.blockType === "heading" || block.blockType === "paragraph") {
      return block.props.text?.slice(0, 40) ?? block.blockType;
    }
    return block.blockType;
  };

  function addBlock(type: Parameters<typeof makeBlock>[0]) {
    const row = nextFreeRow(state.present.blocks, state.activePageIndex);
    dispatch({
      type: "ADD_BLOCK",
      block: fitBlock(makeBlock(type, state.activePageIndex, row)),
    });
    setAnnouncement(`${type} added at row ${String(row + 1)}.`);
  }

  function addQuestion(questionId: string) {
    if (questionId === "") return;
    if (
      state.present.blocks.some((block) => block.questionId === questionId)
    ) {
      // The DB enforces this too (uq_form_blocks_question); catching it here
      // means the admin hears about it now rather than at submit time.
      toast.error("That question is already on this form.");
      return;
    }
    const row = nextFreeRow(state.present.blocks, state.activePageIndex);
    // Sized from the question itself: a five-choice select renders as a radio
    // group more than twice the height of a text box, and a block that lands
    // too short overlaps whatever comes after it.
    dispatch({
      type: "ADD_BLOCK",
      block: fitBlock(
        makeBlock("question", state.activePageIndex, row, { questionId }),
      ),
    });
  }

  /** Grow every block to fit its content and re-stack so nothing overlaps. */
  function tidyLayout() {
    if (layoutFixes.length === 0) return;
    const count = layoutFixes.length;
    dispatch({ type: "SET_RECTS", changes: layoutFixes });
    setAnnouncement(`${String(count)} ${count === 1 ? "field" : "fields"} repositioned.`);
    toast.success(
      `${String(count)} ${count === 1 ? "field" : "fields"} resized to fit. Save to keep it.`,
    );
  }

  async function onSave() {
    await toastPromise(
      save.mutateAsync(state.present).then((saved) => {
        dispatch({
          type: "MARK_SAVED",
          document: { pages: saved.pages, theme: saved.theme, blocks: saved.blocks },
        });
      }),
      "form-save",
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={label}
        breadcrumbs={[
          { label: "Forms", to: "/admin/forms" },
          { label },
        ]}
        meta={
          <div className="flex items-center gap-2">
            <Chip tone={status === "active" ? "success" : "neutral"} size="sm">
              {status === "active" ? "Live" : status === "draft" ? "Draft" : "Off"}
            </Chip>
            {dirty ? (
              <Chip tone="warning" size="sm">
                Unsaved changes
              </Chip>
            ) : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Undo"
              disabled={state.past.length === 0}
              onClick={() => dispatch({ type: "UNDO" })}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Redo"
              disabled={state.future.length === 0}
              onClick={() => dispatch({ type: "REDO" })}
            >
              <Redo2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            {status === "active" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `${window.location.origin}${publicPath}`,
                  );
                  toast.success("Public link copied.");
                }}
              >
                <Copy className="mr-1 h-3 w-3" aria-hidden="true" />
                Copy link
              </Button>
            ) : null}
            {status === "active" && hasDraft ? (
              /*
               * Publishing in place.
               *
               * activate() publishes whatever draft exists and does not require
               * the form to be inactive, so editing a live form never has to
               * take its public link down. Without this button the only route
               * was Turn off → Activate, which is an outage for /register.
               */
              <Button
                size="sm"
                onClick={() => {
                  setServerBlockers([]);
                  setStatus.mutate("active", {
                    onError: (error) => setServerBlockers(errorFieldMessages(error)),
                    onSuccess: () => setServerBlockers([]),
                  });
                }}
                disabled={setStatus.isPending}
              >
                Publish changes
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setServerBlockers([]);
                setStatus.mutate(status === "active" ? "inactive" : "active", {
                  onError: (error) => setServerBlockers(errorFieldMessages(error)),
                  onSuccess: () => setServerBlockers([]),
                });
              }}
            >
              {status === "active" ? "Turn off" : "Activate"}
            </Button>
            {readOnly ? (
              <Button
                size="sm"
                disabled={createDraft.isPending}
                onClick={() => {
                  const id = "new-draft";
                  toast.loading("Starting a new draft…", { id });
                  createDraft.mutate(undefined, {
                    onSuccess: () => toast.success("New draft started.", { id }),
                    onError: (error) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not start a draft.",
                        { id },
                      ),
                  });
                }}
              >
                <Pencil className="mr-1 h-3 w-3" aria-hidden="true" />
                New draft
              </Button>
            ) : (
              <Button size="sm" onClick={() => void onSave()} disabled={!dirty}>
                <Save className="mr-1 h-3 w-3" aria-hidden="true" />
                Save
              </Button>
            )}
            {isDefault ? null : (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${label}`}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash className="h-4 w-4 text-danger-text" aria-hidden="true" />
              </Button>
            )}
          </div>
        }
      />

      {creatingQuestion && candidateCategories.data !== undefined ? (
        <QuestionEditor
          state={{
            mode: "create",
            categoryId: candidateCategories.data[0]?.id ?? "",
          }}
          categories={candidateCategories.data}
          // Pinned: a question born in the form builder is a candidate
          // question, and the audience picker would only be a way to get it
          // wrong.
          audience="candidate"
          onCreated={handleQuestionCreated}
          onClose={() => setCreatingQuestion(false)}
        />
      ) : null}

      <TypedConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${label}"?`}
        description={
          <>
            The form is removed from the list and its public link stops working.
            Submissions already made are kept on the candidates who made them.
            {status === "active" ? (
              <strong className="mt-2 block text-danger-text">
                This form is live. Turn it off first — a link people may be
                filling in right now cannot be deleted.
              </strong>
            ) : null}
          </>
        }
        confirmName={label}
        confirmLabel="Delete form"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          await remove.mutateAsync();
          navigate("/admin/forms");
        }}
      />

      {readOnly ? (
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
          This version is published and cannot be edited. Turn the form off and
          start a new draft to make changes.
        </p>
      ) : null}

      <ActivationBlockers
        blockers={blockers}
        serverBlockers={serverBlockers}
        isActive={status === "active"}
        hasDraft={hasDraft}
      />

      {/*
        Fields that do not fit the box they were given.

        The canvas grid has fixed 8px rows, so a field taller than its row span
        does not push the next one down — it renders on top of it. That is
        invisible to the admin until they open the live form, which is exactly
        how it shipped: every block used to be created 8 rows tall regardless
        of what it renders.

        Offered rather than applied. Rearranging someone's layout the moment
        they open a form is not a repair they asked for, and on a published
        version there is nothing to save it to.
      */}
      {layoutFixes.length > 0 ? (
        <section
          aria-label="Fields that do not fit"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-warning-subtle px-3 py-2.5"
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text"
              aria-hidden="true"
            />
            <p className="min-w-0 text-xs text-neutral-800">
              <span className="font-semibold text-warning-text">
                {layoutFixes.length}{" "}
                {layoutFixes.length === 1 ? "field does" : "fields do"} not fit
                the space {layoutFixes.length === 1 ? "it has" : "they have"}.
              </span>{" "}
              {/* Deliberately the mechanism, not a claim about this form: a
                  field can be too short with nothing beneath it to overlap. */}
              A field taller than its box renders on top of whatever is under it.
            </p>
          </div>
          {readOnly ? (
            <p className="text-xs text-neutral-700">
              Start a new draft to fix this.
            </p>
          ) : (
            <Button size="sm" variant="secondary" onClick={tidyLayout}>
              Tidy layout
            </Button>
          )}
        </section>
      ) : null}

      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          mode === "edit" &&
            "lg:grid-cols-[15rem_1fr] xl:grid-cols-[15rem_1fr_20rem]",
        )}
      >
        {/* Left: palette + layers. Hidden in preview — nothing here applies
            when you are looking at the form rather than building it. */}
        <aside
          className="space-y-4 rounded-lg border border-neutral-200 bg-surface-raised p-3"
          hidden={mode === "preview"}
        >
          <section className="space-y-2">
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
              Add a field
            </h2>
            <NativeSelect
              aria-label="Add a question from the library"
              value=""
              onChange={(event) => addQuestion(event.target.value)}
            >
              <option value="">Choose a question…</option>
              {questions.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={readOnly || candidateCategories.data === undefined}
              onClick={() => setCreatingQuestion(true)}
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
              New question…
            </Button>
          </section>

          <section className="space-y-2">
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
              Layout
            </h2>
            <div className="grid grid-cols-2 gap-1">
              {CONTENT_BLOCKS.map((entry) => (
                <Button
                  key={entry.type}
                  size="sm"
                  variant="secondary"
                  onClick={() => addBlock(entry.type)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </section>

          <ExtraStepsPanel
            hasTypingTest={hasTypingTest}
            hasDocumentsStep={hasDocumentsStep}
            isSaving={updateForm.isPending}
            isLive={status === "active"}
            onChange={(patch) => updateForm.mutateAsync(patch)}
          />

          <section className="space-y-2">
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
              Layers
            </h2>
            <LayerTree
              blocks={state.present.blocks.filter(
                (block) => block.pageIndex === state.activePageIndex,
              )}
              selectedIds={state.selectedIds}
              labelFor={labelFor}
              onSelect={(ids) => dispatch({ type: "SELECT", ids })}
              onRestack={(id, direction) => dispatch({ type: "RESTACK", id, direction })}
              onDelete={(ids) => dispatch({ type: "DELETE_BLOCKS", ids })}
              onEdit={(id) => dispatch({ type: "SELECT", ids: [id] })}
            />
          </section>
        </aside>

        {/* Centre: canvas.
            min-w-0 is load-bearing: a grid item defaults to min-width:auto, so
            without it the wide authoring canvas stretches this column and the
            whole PAGE scrolls sideways instead of just the canvas. */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StepBar
              pages={state.present.pages}
              activeIndex={state.activePageIndex}
              blockCountFor={(pageIndex) =>
                state.present.blocks.filter((block) => block.pageIndex === pageIndex)
                  .length
              }
              onSelect={(pageIndex) => dispatch({ type: "SET_PAGE", pageIndex })}
              onAdd={(title) => {
                dispatch({ type: "ADD_PAGE", title });
                dispatch({
                  type: "SET_PAGE",
                  pageIndex: state.present.pages.length,
                });
              }}
              onRename={(index, title, description) =>
                dispatch({ type: "RENAME_PAGE", index, title, description })
              }
              onDelete={(index) => {
                dispatch({ type: "DELETE_PAGE", index });
                // Deleting re-indexes the remaining steps, so land somewhere
                // that still exists rather than on a now-missing index.
                dispatch({
                  type: "SET_PAGE",
                  pageIndex: Math.max(0, Math.min(index, state.present.pages.length - 2)),
                });
              }}
            />
            <div className="flex items-center gap-1">
              {/* Edit shows the grid, selection and handles; Preview shows the
                  form a candidate actually meets, with working fields. */}
              <div className="mr-1 flex items-center rounded-md border border-border-default p-0.5">
                <Button
                  size="sm"
                  variant={mode === "edit" ? "secondary" : "ghost"}
                  aria-pressed={mode === "edit"}
                  onClick={() => setMode("edit")}
                >
                  <Pencil className="mr-1 h-3 w-3" aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={mode === "preview" ? "secondary" : "ghost"}
                  aria-pressed={mode === "preview"}
                  onClick={() => setMode("preview")}
                >
                  <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
                  Preview
                </Button>
              </div>
              <Button
                size="sm"
                variant={device === "desktop" ? "secondary" : "ghost"}
                aria-label="Desktop preview"
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                <Monitor className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant={device === "mobile" ? "secondary" : "ghost"}
                aria-label="Phone preview"
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone className="h-4 w-4" aria-hidden="true" />
              </Button>
              {selected !== null && mode === "edit" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${labelFor(selected)}`}
                  onClick={() =>
                    dispatch({ type: "DELETE_BLOCKS", ids: [selected.id] })
                  }
                >
                  <Trash2 className="h-4 w-4 text-danger-text" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>

          {/* The device toggle narrows the CONTAINER, and the layout is driven
              by a container query — so this preview is the real phone
              rendering, not a simulation of one. */}
          <div
            className={cn(
              "sdb-builder-viewport mx-auto rounded-lg border border-neutral-200 bg-surface-raised",
              device === "mobile" && "shadow-md",
            )}
            style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
          >
            {mode === "preview" ? (
              <PreviewPane
                document={state.present}
                questionsById={canvasQuestions}
                hasTypingTest={hasTypingTest}
                hasDocumentsStep={hasDocumentsStep}
              />
            ) : page === undefined ? (
              <p className="p-6 text-sm text-neutral-500">This step has no content.</p>
            ) : (
              <BuilderCanvas
                blocks={state.present.blocks}
                questionsById={canvasQuestions}
                pageIndex={state.activePageIndex}
                selectedIds={state.selectedIds}
                dispatch={dispatch}
                announce={setAnnouncement}
                labelFor={labelFor}
                device={device}
                onEdit={(id) => {
                  // The inspector already follows selection, so "edit" means
                  // select and bring the panel into view on a short screen.
                  dispatch({ type: "SELECT", ids: [id] });
                  inspectorRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                  });
                }}
                onDuplicate={(id) =>
                  dispatch({
                    type: "DUPLICATE_BLOCKS",
                    ids: [id],
                    newIds: [newBlockId()],
                  })
                }
                renderQuestion={(question, block) => (
                  <div className="pointer-events-none">
                    <QuestionField
                      question={effectiveQuestion(block, question)}
                      value={undefined}
                      onChange={() => undefined}
                      onBlur={() => undefined}
                      error={undefined}
                    />
                  </div>
                )}
              />
            )}
          </div>

          {/* Without this, a keyboard user nudging a block is working blind. */}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        {/* Right: inspector */}
        <aside
          ref={inspectorRef}
          className="rounded-lg border border-neutral-200 bg-surface-raised p-3"
          hidden={mode === "preview"}
        >
          <Inspector
            block={selected}
            theme={state.present.theme}
            // Content edits here change how tall a block renders, so they go
            // through the auto-fitting dispatch rather than the raw one.
            dispatch={dispatchFitting}
            question={inspectorQuestion}
          />
          {status === "active" ? (
            <a
              href={publicPath}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-xs text-brand-blue underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Open the public form
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** loading → success/error under one toast id, per the house convention. */
async function toastPromise(promise: Promise<unknown>, id: string): Promise<void> {
  toast.loading("Saving…", { id });
  try {
    await promise;
    toast.success("Form saved.", { id });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Could not save the form.",
      { id },
    );
  }
}
