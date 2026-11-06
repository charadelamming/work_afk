import { describe, it } from "vitest";

import { buildCases } from "../../scripts/lib/checks.cjs";
import * as format from "../../src/core/format";
import * as holidays from "../../src/core/holidays";
import * as pay from "../../src/core/pay";
import * as types from "../../src/core/types";

// 与 scripts/check-calc.cjs 共用同一套断言，保证「94 条用例」只有一份来源。
const cases = buildCases({ pay, types, format, holidays });

describe("计薪引擎", () => {
  for (const item of cases) {
    it(item.name, () => {
      item.fn();
    });
  }
});
