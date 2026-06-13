import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Render lesson/teaching content written in Markdown (bold, italics, bullets,
 * numbered lists). react-markdown does NOT render raw HTML by default, so this
 * is safe for stored content. Styling is applied via arbitrary-variant classes
 * (no typography plugin needed) to keep the friendly, readable lesson look.
 */
export const Markdown = ({ children }: { children: string }) => (
  <div
    className="text-base font-medium leading-relaxed text-neutral-700 [&_a]:text-sky-600 [&_a]:underline [&_em]:italic [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-bold [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_strong]:font-bold [&_strong]:text-neutral-800 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 last:[&_p]:mb-0"
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </div>
);
