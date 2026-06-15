export type EditorOption = { id: number; text: string; correct: boolean };
export type EditorQuestion = {
  id: number;
  question: string;
  type: "SELECT" | "ASSIST";
  explanation: string | null;
  options: EditorOption[];
};
export type EditorLessonImage = {
  id: string;
  ref: string;
  kind: "ICON" | "ILLUSTRATION" | "REALISTIC";
  status: "PENDING" | "GENERATING" | "GENERATED" | "FAILED";
  src: string | null;
  prompt: string;
};
export type EditorLessonAudio = {
  /** courseAssets.id of the AUDIO asset — needed to regenerate this voiceover. */
  id: string;
  status: "PENDING" | "GENERATING" | "GENERATED" | "FAILED";
  src: string | null;
};
/** A lesson-anatomy teach item (Phase 2) as the studio editor sees it: the raw
 * payload (for editing) plus its kind/order. Media previews are built from the
 * payload's media ids client-side. */
export type EditorLessonItem = {
  id: number;
  kind: "teaching" | "image_pair" | "voice_note" | "narrative";
  order: number;
  payload: Record<string, unknown>;
};
export type EditorLesson = {
  id: number;
  title: string;
  teachingText: string | null;
  images: EditorLessonImage[];
  audio: EditorLessonAudio | null;
  items: EditorLessonItem[];
  questions: EditorQuestion[];
};
export type EditorUnit = { id: number; title: string; lessons: EditorLesson[] };
export type EditorModule = { id: number; title: string; units: EditorUnit[] };
export type EditorCourse = {
  id: number;
  title: string;
  published: boolean;
  modules: EditorModule[];
};

export const inputClass =
  "w-full rounded-lg border-2 px-3 py-1.5 text-sm outline-none focus:border-brand";
