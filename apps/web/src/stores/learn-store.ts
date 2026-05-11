import { type LessonId, type TrackId, getLesson } from "@paper/shared";
import { create } from "zustand";

interface LearnState {
  /** The lesson currently being played; null when on the picker or transitioning. */
  currentLessonId: LessonId | null;
  /** 0-indexed step position. equals lesson.steps.length when on the quiz. */
  currentStepIndex: number;
  /** Index of the option the user tapped in the quiz, or null. */
  selectedAnswer: number | null;
  /** True after the user presses "Check answer". */
  quizSubmitted: boolean;
  /** Set by the route handler when the server flags track completion. */
  trackJustCompleted: TrackId | null;

  startLesson: (id: LessonId) => void;
  nextStep: () => void;
  prevStep: () => void;
  selectAnswer: (idx: number | null) => void;
  submitQuiz: () => void;
  setTrackJustCompleted: (id: TrackId | null) => void;
  resetLesson: () => void;
}

const initial: Pick<
  LearnState,
  "currentLessonId" | "currentStepIndex" | "selectedAnswer" | "quizSubmitted" | "trackJustCompleted"
> = {
  currentLessonId: null,
  currentStepIndex: 0,
  selectedAnswer: null,
  quizSubmitted: false,
  trackJustCompleted: null,
};

export const useLearnStore = create<LearnState>((set) => ({
  ...initial,
  startLesson: (id) =>
    set({
      currentLessonId: id,
      currentStepIndex: 0,
      selectedAnswer: null,
      quizSubmitted: false,
    }),
  nextStep: () =>
    set((state) => {
      if (state.currentLessonId === null) return state;
      const lesson = getLesson(state.currentLessonId);
      if (!lesson) return state;
      const max = lesson.steps.length; // index == steps.length is the quiz "slide"
      return { currentStepIndex: Math.min(state.currentStepIndex + 1, max) };
    }),
  prevStep: () => set((state) => ({ currentStepIndex: Math.max(0, state.currentStepIndex - 1) })),
  selectAnswer: (idx) => set((state) => (state.quizSubmitted ? state : { selectedAnswer: idx })),
  submitQuiz: () =>
    set((state) => (state.selectedAnswer === null ? state : { quizSubmitted: true })),
  setTrackJustCompleted: (id) => set({ trackJustCompleted: id }),
  resetLesson: () => set(initial),
}));
