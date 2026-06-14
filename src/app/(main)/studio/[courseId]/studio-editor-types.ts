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
export type EditorLesson = {
  id: number;
  title: string;
  teachingText: string | null;
  images: EditorLessonImage[];
  audio: EditorLessonAudio | null;
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
  "w-full rounded-lg border-2 px-3 py-1.5 text-sm outline-none focus:border-green-500";
