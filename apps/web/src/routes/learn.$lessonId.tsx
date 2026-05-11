import { LessonQuiz } from "@/components/learn/LessonQuiz";
import { LessonStepCard } from "@/components/learn/LessonStepCard";
import { LessonStepIndicator } from "@/components/learn/LessonStepIndicator";
import { TrackCompleteModal } from "@/components/learn/TrackCompleteModal";
import { Button } from "@/components/ui/button";
import { posthog } from "@/lib/posthog";
import { useLearnStore } from "@/stores/learn-store";
import {
  getV1LearnStateQueryKey,
  useGetV1LearnState,
  usePostV1LessonsIdComplete,
} from "@paper/api-client";
import {
  type LessonId,
  TRACKS,
  type TrackId,
  getLesson,
  getTrack,
  isLessonId,
  lessonsByTrack,
} from "@paper/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

export const Route = createFileRoute("/learn/$lessonId")({
  component: LessonPage,
});

function LessonPage() {
  const { lessonId: rawLessonId } = useParams({ from: "/learn/$lessonId" });
  const lessonId = decodeURIComponent(rawLessonId);

  if (!isLessonId(lessonId)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper p-6">
        <p className="font-display text-ink text-lg font-semibold">Lesson not found.</p>
        <Button asChild variant="ghost">
          <Link to="/learn">← Back to Lessons</Link>
        </Button>
      </main>
    );
  }

  return <LessonView lessonId={lessonId} />;
}

function LessonView({ lessonId }: { lessonId: LessonId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Safe: lessonId is validated by isLessonId in the parent; both will always resolve.
  // biome-ignore lint/style/noNonNullAssertion: lessonId is validated above
  const lesson = getLesson(lessonId)!;
  // biome-ignore lint/style/noNonNullAssertion: trackId is always present for a valid lesson
  const track = getTrack(lesson.trackId)!;
  const pastel = track.pastel;

  // Store
  const currentStepIndex = useLearnStore((s) => s.currentStepIndex);
  const selectedAnswer = useLearnStore((s) => s.selectedAnswer);
  const quizSubmitted = useLearnStore((s) => s.quizSubmitted);
  const trackJustCompleted = useLearnStore((s) => s.trackJustCompleted);
  const startLesson = useLearnStore((s) => s.startLesson);
  const nextStep = useLearnStore((s) => s.nextStep);
  const prevStep = useLearnStore((s) => s.prevStep);
  const selectAnswer = useLearnStore((s) => s.selectAnswer);
  const submitQuiz = useLearnStore((s) => s.submitQuiz);
  const setTrackJustCompleted = useLearnStore((s) => s.setTrackJustCompleted);
  const resetLesson = useLearnStore((s) => s.resetLesson);

  // Reset store when lessonId changes (navigating between lessons)
  useEffect(() => {
    startLesson(lessonId);
  }, [lessonId, startLesson]);

  // Server state for progress + next-lesson computation
  const { data: learnState } = useGetV1LearnState({ query: { staleTime: 60_000 } });
  const completedSet = useMemo(() => {
    return new Set(
      (learnState?.lessons ?? []).filter((l) => l.completed_at !== null).map((l) => l.id),
    );
  }, [learnState]);

  const alreadyCompleted = completedSet.has(lessonId);

  // Next incomplete lesson — same track first, then later tracks, null if all done
  const nextLessonId = useMemo<LessonId | null>(() => {
    if (!learnState) return null;
    const trackLessons = lessonsByTrack(lesson.trackId);
    const currentIdx = trackLessons.findIndex((l) => l.id === lessonId);
    for (let i = currentIdx + 1; i < trackLessons.length; i++) {
      const candidate = trackLessons[i];
      if (candidate && !completedSet.has(candidate.id)) return candidate.id;
    }
    const trackIdx = TRACKS.findIndex((t) => t.id === lesson.trackId);
    for (let ti = trackIdx + 1; ti < TRACKS.length; ti++) {
      const tr = TRACKS[ti];
      if (!tr) continue;
      const tLessons = lessonsByTrack(tr.id);
      const next = tLessons.find((l) => !completedSet.has(l.id));
      if (next) return next.id;
    }
    return null;
  }, [learnState, completedSet, lessonId, lesson.trackId]);

  // Mutation
  const complete = usePostV1LessonsIdComplete();

  const totalSteps = lesson.steps.length + 1;
  const isQuizStep = currentStepIndex === lesson.steps.length;
  const isCorrect = quizSubmitted && selectedAnswer === lesson.quiz.correctIndex;
  const currentStep = !isQuizStep ? lesson.steps[currentStepIndex] : null;

  async function handleComplete() {
    if (!isQuizStep || !quizSubmitted || !isCorrect || alreadyCompleted) return;
    try {
      const res = await complete.mutateAsync({
        id: encodeURIComponent(lessonId),
        data: { quiz_score: 100 },
      });
      posthog.capture("lesson_completed", {
        lesson_id: lessonId,
        track_id: lesson.trackId,
      });
      if (res.is_first_lesson) {
        posthog.capture("first_lesson_completed", { lesson_id: lessonId });
      }
      if (res.track_just_completed) {
        setTrackJustCompleted(res.track_just_completed as TrackId);
      }
      await queryClient.invalidateQueries({ queryKey: getV1LearnStateQueryKey() });
    } catch {
      // Server error — leave UI as-is; user can retry.
    }
  }

  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/learn">← Lessons</Link>
          </Button>
          <span className="font-display text-ink-soft text-sm">{track.title}</span>
        </div>

        {/* Step indicator */}
        <LessonStepIndicator total={totalSteps} current={currentStepIndex} />

        {/* Lesson title */}
        <div>
          <p className="font-display text-ink-soft text-xs uppercase tracking-widest">
            {lesson.order} of {track.lessonIds.length}
          </p>
          <h1 className="mt-1 font-display font-bold text-ink text-xl leading-tight">
            {lesson.title}
          </h1>
        </div>

        {/* Step or quiz */}
        {isQuizStep ? (
          <LessonQuiz
            quiz={lesson.quiz}
            selectedAnswer={selectedAnswer}
            quizSubmitted={quizSubmitted}
            pastel={pastel}
            onSelect={selectAnswer}
            onSubmit={submitQuiz}
          />
        ) : currentStep ? (
          <LessonStepCard step={currentStep} pastel={pastel} />
        ) : null}

        {/* Result feedback */}
        {quizSubmitted ? (
          <div
            className={
              isCorrect
                ? "rounded-xl bg-mint/30 px-4 py-3 font-display font-semibold text-ink text-sm"
                : "rounded-xl bg-peach/30 px-4 py-3 font-display font-semibold text-ink text-sm"
            }
          >
            {isCorrect
              ? "Correct! Well done."
              : `Not quite. The correct answer was: "${lesson.quiz.options[lesson.quiz.correctIndex]}"`}
          </div>
        ) : null}

        {/* Navigation */}
        <div className="flex gap-3">
          {currentStepIndex > 0 ? (
            <Button variant="secondary" size="md" onClick={prevStep} disabled={complete.isPending}>
              ← Back
            </Button>
          ) : null}

          {!isQuizStep ? (
            <Button variant="primary" size="md" fullWidth onClick={nextStep}>
              Next →
            </Button>
          ) : quizSubmitted ? (
            isCorrect ? (
              alreadyCompleted || complete.isSuccess ? (
                nextLessonId ? (
                  <Button asChild variant="primary" size="md" fullWidth>
                    <Link
                      to="/learn/$lessonId"
                      params={{ lessonId: encodeURIComponent(nextLessonId) }}
                      onClick={resetLesson}
                    >
                      Next lesson →
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="primary" size="md" fullWidth>
                    <Link to="/learn" onClick={resetLesson}>
                      Back to Learn
                    </Link>
                  </Button>
                )
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onClick={handleComplete}
                  disabled={complete.isPending}
                >
                  {complete.isPending ? "Saving…" : "Complete lesson →"}
                </Button>
              )
            ) : (
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => {
                  useLearnStore.setState({ selectedAnswer: null, quizSubmitted: false });
                }}
              >
                Try again
              </Button>
            )
          ) : null}
        </div>
      </div>

      {/* Track complete modal */}
      <TrackCompleteModal
        trackId={trackJustCompleted}
        onDismiss={() => {
          setTrackJustCompleted(null);
          if (nextLessonId) {
            navigate({
              to: "/learn/$lessonId",
              params: { lessonId: encodeURIComponent(nextLessonId) },
            });
          } else {
            navigate({ to: "/learn" });
          }
        }}
      />
    </main>
  );
}
