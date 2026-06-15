// One-off SQL runner for owner-role DDL (Phase 2 migration + rls re-run).
// Uses the neon HTTP driver and a dollar-quote-aware splitter so DO $$ blocks
// and function bodies execute as single statements. Usage:
//   node --env-file=.env scripts/run-sql.mjs <file.sql> [<file2.sql> ...]
//   node --env-file=.env scripts/run-sql.mjs --check   (read-only existence probe)
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// Prefer an explicit owner URL; fall back to DATABASE_URL when the owner var is
// unset or a placeholder (some envs ship `…<owner>:<password>@<host>…`). DDL
// requires a privileged role (e.g. neondb_owner), NOT the app_runtime role.
let url = process.env.DATABASE_URL_OWNER;
if (!url || url.includes("<")) url = process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL_OWNER / DATABASE_URL set");
  process.exit(1);
}

const sql = neon(url);

/** Split SQL into statements, respecting $tag$…$tag$ dollar-quoting and
 * line/block comments — so semicolons inside DO blocks don't split. */
const splitStatements = (text) => {
  const stmts = [];
  let buf = "";
  let i = 0;
  let dollarTag = null; // e.g. "$$" or "$body$"
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (!dollarTag && two === "--") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (!dollarTag && two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text[i] === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        if (!dollarTag) dollarTag = tag;
        else if (dollarTag === tag) dollarTag = null;
        buf += tag;
        i += tag.length;
        continue;
      }
    }
    if (!dollarTag && text[i] === ";") {
      if (buf.trim()) stmts.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  if (buf.trim()) stmts.push(buf.trim());
  return stmts;
};

const main = async () => {
  if (process.argv[2] === "--check") {
    const rows = await sql`SELECT to_regclass('public.lessons') AS lessons,
      to_regclass('public.lesson_items') AS lesson_items,
      to_regclass('public.lesson_item_translations') AS lesson_item_translations`;
    console.log(JSON.stringify(rows[0]));
    return;
  }
  for (const file of process.argv.slice(2)) {
    const statements = splitStatements(readFileSync(file, "utf8"));
    process.stdout.write(`Applying ${file} (${statements.length} statements) … `);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    console.log("ok");
  }
};

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
