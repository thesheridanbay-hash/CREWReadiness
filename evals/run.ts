import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DirectAdapter } from "../src/features/ai/adapters/direct";
import { containsAnswer } from "../src/features/ai/guard";
import {
  buildLessonPrompt,
  buildPhotoPrompt,
  buildReteachPrompt,
  buildVariantPrompt,
} from "../src/features/ai/prompts";
import { lessonDraftSchema, photoAnalysisSchema, variantBatchSchema } from "../src/features/ai/types";

/**
 * Eval runner (D19): six CI-gated suites — text-gen, photo-gen, reteach,
 * variant-gen, spanish, injection. Prompt changes must keep these green.
 *
 * Env: EVAL_BASE_URL (default api.openai.com/v1), EVAL_MODEL, EVAL_API_KEY.
 * Exits non-zero on any failure. npm run evals
 */

type Case = Record<string, unknown> & { id: string; assert: string[] };

const config = {
  baseUrl: process.env.EVAL_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.EVAL_MODEL ?? "gpt-4o-mini",
  apiKey: process.env.EVAL_API_KEY ?? "",
};

if (!config.apiKey) {
  console.error("EVAL_API_KEY is not set — eval suites cannot run.");
  process.exit(1);
}

const adapter = new DirectAdapter(config);

const checkAssertion = (
  assertion: string,
  output: unknown,
  testCase: Case
): string | null => {
  const text = typeof output === "string" ? output : JSON.stringify(output);

  if (assertion === "schema:lesson")
    return lessonDraftSchema.safeParse(output).success
      ? null
      : "lesson schema invalid";
  if (assertion === "schema:photo")
    return photoAnalysisSchema.safeParse(output).success
      ? null
      : "photo schema invalid";
  if (assertion === "schema:variants")
    return variantBatchSchema.safeParse(output).success
      ? null
      : "variants schema invalid";
  if (assertion === "no-leak")
    return containsAnswer(text, testCase.correctAnswers as string[])
      ? "LEAKED the correct answer"
      : null;
  if (assertion === "distinct-prompts") {
    const prompts = (output as Array<{ prompt: string }>).map((v) => v.prompt);
    return new Set(prompts).size === prompts.length ? null : "duplicate prompts";
  }
  if (assertion === "not-verbatim") {
    const prompts = (output as Array<{ prompt: string }>).map((v) => v.prompt);
    return prompts.some((p) => p.trim() === (testCase.question as string).trim())
      ? "variant repeats the original question verbatim"
      : null;
  }
  if (assertion.startsWith("mentions:")) {
    const term = assertion.slice("mentions:".length).toLowerCase();
    return text.toLowerCase().includes(term) ? null : `missing term "${term}"`;
  }
  if (assertion.startsWith("not-contains:")) {
    const term = assertion.slice("not-contains:".length).toLowerCase();
    return text.toLowerCase().includes(term)
      ? `contains forbidden "${term}"`
      : null;
  }
  if (assertion.startsWith("max-words:")) {
    const max = Number(assertion.slice("max-words:".length));
    const words = text.split(/\s+/).length;
    return words <= max ? null : `${words} words > ${max}`;
  }
  if (assertion === "language:es") {
    return /[áéíóñ¿¡]/i.test(text) ? null : "output does not look Spanish";
  }

  return `unknown assertion: ${assertion}`;
};

const runCase = async (suite: string, testCase: Case): Promise<unknown> => {
  if (suite === "reteach" || testCase.suite_kind === "reteach") {
    const stream = await adapter.streamText({
      prompt: buildReteachPrompt({
        question: String(testCase.question),
      }),
    });
    let out = "";
    for await (const chunk of stream) out += chunk;
    return out;
  }
  if (suite === "variant-gen") {
    const { content } = await adapter.generateJson({
      prompt: buildVariantPrompt({
        question: String(testCase.question),
        explanation: String(testCase.explanation),
        count: Number(testCase.count ?? 3),
      }),
    });
    return content;
  }
  if (suite === "photo-gen") {
    const { content } = await adapter.generateJson({
      prompt: buildPhotoPrompt(String(testCase.ownerNote)),
    });
    return content;
  }
  // text-gen, spanish, and lesson-shaped injection cases.
  const { content } = await adapter.generateJson({
    prompt: buildLessonPrompt(String(testCase.input)),
  });
  return content;
};

const main = async () => {
  const file = JSON.parse(
    readFileSync(join(__dirname, "cases", "cases.json"), "utf8")
  ) as { suites: Record<string, Case[]> };

  let failures = 0;
  let total = 0;

  for (const [suite, cases] of Object.entries(file.suites)) {
    for (const testCase of cases) {
      total += 1;
      try {
        const output = await runCase(suite, testCase);

        for (const assertion of testCase.assert) {
          const problem = checkAssertion(assertion, output, testCase);
          if (problem) {
            failures += 1;
            console.error(`FAIL ${suite}/${testCase.id} [${assertion}]: ${problem}`);
          }
        }
        console.log(`ok   ${suite}/${testCase.id}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${suite}/${testCase.id}: ${String(error)}`);
      }
    }
  }

  console.log(`\n${total - failures}/${total} eval cases passed`);
  process.exit(failures > 0 ? 1 : 0);
};

void main();
