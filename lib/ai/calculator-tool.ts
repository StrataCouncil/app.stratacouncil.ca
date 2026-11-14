import { z } from "zod";
import type { ClientTool } from "@/lib/ai/claude";
import { ToolInputError } from "@/lib/ai/claude";
import { calculate } from "@/lib/ai/calculator";

/**
 * Stratasphere's `calculate` tool: Claude writes the steps, lib/ai/calculator.ts
 * works them out exactly. Server only.
 */

const Input = z.object({
  calculations: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        label: z.string().min(1).max(500),
        expression: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(200),
});

export const calculatorTool: ClientTool = {
  definition: {
    name: "calculate",
    description: `Works out arithmetic and date counts exactly. Use it for every sum, difference, share, proration, percentage, average, and count of days or months in an answer: never do arithmetic in your head.

Send the steps in order. Each step has a name (lower-case, e.g. annual_premium), a label saying what it is and where each figure comes from (e.g. "Annual premium, from the 2026-27 insurance certificate"), and an expression. Later steps can use earlier names.

Expressions: plain numbers (84000, 1250.50: no commas, $, or %), + - * / ^, brackets, dates as 'YYYY-MM-DD', and these functions:
days(start, end): days from start to end, both included.
overlap_days(a_start, a_end, b_start, b_end): days in both periods, ends included (0 if none).
months(start, end): calendar months from start to end, both included; a part month counts as its share of that month's days. months('2026-09-01', '2028-02-29') is 18.
overlap_months(a_start, a_end, b_start, b_end): months() of the part in both periods.
add_days(date, n), add_months(date, n): a date n days or months later (negative for earlier). A period of 18 months from 2026-09-01 ends on add_days(add_months('2026-09-01', 18), -1).
round(x) or round(x, places): half away from zero; round money to 2 places only at the end.
min(...), max(...), sum(...), abs(x).

Each result comes back with its name; a step with a mistake comes back with an error to fix and resend.`,
    input_schema: {
      type: "object",
      properties: {
        calculations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Lower-case identifier for this result." },
              label: { type: "string", description: "What it is, and the source of each figure in it." },
              expression: { type: "string" },
            },
            required: ["name", "label", "expression"],
          },
        },
      },
      required: ["calculations"],
    },
  },
  run(input) {
    // Eager input streaming skips the server's schema check: check here.
    const parsed = Input.safeParse(input);
    if (!parsed.success) {
      throw new ToolInputError(`The input wasn't in the expected shape (${parsed.error.issues[0]?.message ?? "invalid"}). Send {"calculations": [{"name", "label", "expression"}, ...]}.`);
    }
    const results = calculate(parsed.data.calculations);
    return results
      .map((r) => (r.error ? `${r.name}: ERROR ${r.error} (expression: ${r.expression})` : `${r.name} = ${r.result}    [${r.label}: ${r.expression}]`))
      .join("\n");
  },
};
