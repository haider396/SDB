/**
 * Right pane: questions of the selected category (05 §4.7). Drag/keyboard
 * reorder, per-question metadata chips, answer counts (03 §2.2 — nothing is
 * deactivated blindly), mapped-question lock, and the row actions.
 */
import { useState } from "react";
import { format } from "date-fns";
import { Copy, ListPlus, Lock, Pencil, Trash2 } from "lucide-react";
import type { Question, QuestionDeactivateWarning } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useDuplicateQuestion,
  useReorderQuestions,
  useSetQuestionActive,
} from "../api";
import { isMappedQuestionKey, QUESTION_TYPE_LABELS } from "../guard-rails";
import { ArchiveQuestionDialog } from "./archive-question-dialog";
import { ActiveToggle, Chip } from "./chips";
import { DeactivateWarningsDialog } from "./deactivate-warnings-dialog";
import { SortableList } from "./sortable-list";

function AnswerStats({ question }: { question: Question }) {
  const lastAnswered =
    question.lastAnsweredAt !== undefined && question.lastAnsweredAt !== null
      ? format(new Date(question.lastAnsweredAt), "d MMM yyyy")
      : null;
  return (
    <span className="whitespace-nowrap text-xs text-neutral-500">
      {question.answerCount === 1
        ? "1 answer"
        : `${question.answerCount} answers`}
      {lastAnswered !== null ? ` · last ${lastAnswered}` : ""}
    </span>
  );
}

function MappedLock({ label }: { label: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={`${label} is a mapped question`}
            className="inline-flex rounded-sm text-neutral-500"
          >
            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Mapped question — its answers fill first-class requisition fields, so
          it cannot be archived or re-keyed (03 §3.4).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QuestionRow({
  question,
  onEdit,
  onArchive,
  onToggleActive,
}: {
  question: Question;
  onEdit: () => void;
  onArchive: () => void;
  onToggleActive: (isActive: boolean) => void;
}) {
  const duplicateQuestion = useDuplicateQuestion();
  const isMapped = isMappedQuestionKey(question.key);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-neutral-800">
            {question.label}
          </span>
          {isMapped ? <MappedLock label={question.label} /> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip tone="info">{QUESTION_TYPE_LABELS[question.questionType]}</Chip>
          {question.isRequired ? <Chip>Required</Chip> : null}
          {question.audience === "internal" ? (
            <Chip tone="neutral">Internal</Chip>
          ) : null}
          {!question.isActive ? <Chip tone="warning">Inactive</Chip> : null}
          <AnswerStats question={question} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${question.label}`}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Duplicate ${question.label}`}
          disabled={duplicateQuestion.isPending}
          onClick={() =>
            duplicateQuestion.mutate({
              id: question.id,
              categoryId: question.categoryId,
            })
          }
        >
          <Copy aria-hidden="true" />
        </Button>
        {isMapped ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span wrapper: disabled buttons don't fire tooltips */}
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Archive ${question.label} (not allowed for mapped questions)`}
                    disabled
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Mapped questions cannot be archived — their answers fill
                first-class requisition fields. Deactivate it instead.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Archive ${question.label}`}
            onClick={onArchive}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        <ActiveToggle
          isActive={question.isActive}
          label={`Active: ${question.label}`}
          onChange={onToggleActive}
        />
      </div>
    </div>
  );
}

export function QuestionPane({
  categoryId,
  categoryLabel,
  questions,
  onCreate,
  onEdit,
}: {
  categoryId: string;
  categoryLabel: string;
  questions: Question[];
  onCreate: () => void;
  onEdit: (question: Question) => void;
}) {
  const reorderQuestions = useReorderQuestions();
  const setQuestionActive = useSetQuestionActive();
  const [archiveTarget, setArchiveTarget] = useState<Question | null>(null);
  const [deactivateWarnings, setDeactivateWarnings] = useState<{
    question: Question;
    warnings: QuestionDeactivateWarning[];
  } | null>(null);

  const toggleActive = (question: Question, isActive: boolean) => {
    setQuestionActive.mutate(
      { id: question.id, categoryId, isActive },
      {
        onSuccess: (result) => {
          if (!isActive && result.warnings.length > 0) {
            setDeactivateWarnings({ question, warnings: result.warnings });
          }
        },
      },
    );
  };

  if (questions.length === 0) {
    return (
      <>
        <EmptyState
          icon={ListPlus}
          title={`No questions in ${categoryLabel}`}
          description="Questions in this category appear as one step of the intake form. Add the first one."
          action={<Button onClick={onCreate}>New question</Button>}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <SortableList
        ariaLabel={`Questions in ${categoryLabel}`}
        items={questions}
        onReorder={(orderedQuestionIds) =>
          reorderQuestions.mutate({ categoryId, orderedQuestionIds })
        }
        renderItem={(question) => (
          <QuestionRow
            question={question}
            onEdit={() => onEdit(question)}
            onArchive={() => setArchiveTarget(question)}
            onToggleActive={(isActive) => toggleActive(question, isActive)}
          />
        )}
        rowClassName="px-2"
      />
      <ArchiveQuestionDialog
        question={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
      <DeactivateWarningsDialog
        state={deactivateWarnings}
        onReactivate={(question) => {
          setQuestionActive.mutate({
            id: question.id,
            categoryId,
            isActive: true,
          });
          setDeactivateWarnings(null);
        }}
        onClose={() => setDeactivateWarnings(null)}
      />
    </div>
  );
}
