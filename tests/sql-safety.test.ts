import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Supabase refuses a DELETE without a WHERE clause through its API (the
// pg-safeupdate guard), so a function the app calls must never contain one.
// The local test database doesn't have that guard; this catches it instead.
test("no DELETE without a WHERE clause in the database code", () => {
  const files = [
    ...fs.readdirSync("supabase/migrations").map((f) => path.join("supabase/migrations", f)),
    "supabase/demo/demo.sql",
  ];
  for (const file of files) {
    const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";")) {
      if (/\bdelete\s+from\b/i.test(statement) && !/\bwhere\b/i.test(statement.slice(statement.search(/\bdelete\s+from\b/i)))) {
        assert.fail(`${file}: DELETE without WHERE: ${statement.trim().slice(0, 120)}`);
      }
    }
  }
});
