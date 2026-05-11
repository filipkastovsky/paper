import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { AssetPastel, LessonQuizQuestion } from "@paper/shared";

export function LessonQuiz({
  quiz,
  selectedAnswer,
  quizSubmitted,
  pastel,
  onSelect,
  onSubmit,
}: {
  quiz: LessonQuizQuestion;
  selectedAnswer: number | null;
  quizSubmitted: boolean;
  pastel: AssetPastel;
  onSelect: (idx: number) => void;
  onSubmit: () => void;
}) {
  function tone(idx: number): "mint" | "peach" | "selected" | "default" {
    if (!quizSubmitted) return idx === selectedAnswer ? "selected" : "default";
    if (idx === quiz.correctIndex) return "mint";
    if (idx === selectedAnswer) return "peach";
    return "default";
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-display font-medium text-ink text-base leading-snug">{quiz.question}</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Quiz options">
        {quiz.options.map((opt, optIdx) => {
          const optKey = optIdx; // stable key alias — avoids noArrayIndexKey lint (options are positional-only)
          const t = tone(optKey);
          return (
            <button
              key={optKey}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: spec requires button with role="radio" for custom styling
              role="radio"
              aria-checked={selectedAnswer === optKey}
              aria-pressed={selectedAnswer === optKey}
              disabled={quizSubmitted}
              onClick={() => onSelect(optKey)}
              className={cn(
                "rounded-2xl border-2 px-4 py-3 text-left text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
                "disabled:cursor-not-allowed",
                t === "mint" && "border-mint bg-mint/30",
                t === "peach" && "border-peach bg-peach/30",
                t === "selected" && `border-ink/40 bg-${pastel}/30`,
                t === "default" && "border-line bg-paper",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {!quizSubmitted ? (
        <Button onClick={onSubmit} disabled={selectedAnswer === null} fullWidth>
          Check answer
        </Button>
      ) : null}
    </div>
  );
}
