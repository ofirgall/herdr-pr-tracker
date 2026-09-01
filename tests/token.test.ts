import { describe, expect, test } from "bun:test";
import {
  parsePrNumber,
  refreshingLabel,
  resolvePaneCwd,
  reviewFromDecision,
  rollupBuckets,
  tokenId,
  tokenLabel,
  tokenStatus,
} from "../src/token.ts";

describe("rollupBuckets", () => {
  test("no checks is not a pass", () => {
    expect(rollupBuckets([])).toBe("none");
  });
  test("a cancelled run is not a failure", () => {
    expect(rollupBuckets(["cancel", "pass"])).toBe("pass");
  });
  test("only skipped or cancelled reports no news", () => {
    expect(rollupBuckets(["skipping", "cancel"])).toBe("none");
  });
  test("failure outranks pending", () => {
    expect(rollupBuckets(["pending", "fail"])).toBe("fail");
  });
  test("pending outranks pass", () => {
    expect(rollupBuckets(["pass", "pending"])).toBe("pending");
  });
});

describe("reviewFromDecision", () => {
  test("maps GitHub review decisions", () => {
    expect(reviewFromDecision("APPROVED")).toBe("approved");
    expect(reviewFromDecision("CHANGES_REQUESTED")).toBe("changes-requested");
    expect(reviewFromDecision("REVIEW_REQUIRED")).toBe("review-required");
  });
  test("null or unknown is none", () => {
    expect(reviewFromDecision(null)).toBe("none");
    expect(reviewFromDecision("SOMETHING_ELSE")).toBe("none");
  });
});

describe("tokenId", () => {
  test("plain PR", () => {
    expect(tokenId({ number: 864, ci: "pass", review: "none", isDraft: false })).toBe("#864");
  });
  test("draft PR", () => {
    expect(tokenId({ number: 21288, ci: "pass", review: "none", isDraft: true })).toBe("◌#21288");
  });
});

describe("tokenStatus", () => {
  test("review and CI", () => {
    expect(tokenStatus({ number: 1, ci: "pass", review: "approved", isDraft: false })).toBe("✓ ✓");
  });
  test("CI only", () => {
    expect(tokenStatus({ number: 1, ci: "fail", review: "none", isDraft: false })).toBe("✗");
  });
  test("review only", () => {
    expect(tokenStatus({ number: 1, ci: "none", review: "changes-requested", isDraft: false })).toBe("✗");
  });
  test("nothing", () => {
    expect(tokenStatus({ number: 1, ci: "none", review: "none", isDraft: false })).toBe("");
  });
  test("review required and pending", () => {
    expect(tokenStatus({ number: 1, ci: "pending", review: "review-required", isDraft: false })).toBe("◆ ●");
  });
});

describe("tokenLabel", () => {
  test("combines id and status", () => {
    expect(tokenLabel({ number: 864, ci: "pass", review: "approved", isDraft: false })).toBe("#864 ✓ ✓");
  });
  test("no status means id only", () => {
    expect(tokenLabel({ number: 4, ci: "none", review: "none", isDraft: false })).toBe("#4");
  });
  test("draft with CI only", () => {
    expect(tokenLabel({ number: 21288, ci: "pass", review: "none", isDraft: true })).toBe("◌#21288 ✓");
  });
});

describe("refreshingLabel", () => {
  test("keeps the number and swaps only the glyph", () => {
    expect(refreshingLabel("#864 ✓")).toBe("#864 ⟳");
  });
  test("recovers the number through a draft marker", () => {
    expect(refreshingLabel("◌#864 ✗", true)).toBe("◌#864 ⟳");
  });
  test("no previous label means nothing to keep on screen", () => {
    expect(refreshingLabel(undefined)).toBeNull();
    expect(refreshingLabel("")).toBeNull();
  });
});

describe("parsePrNumber", () => {
  test.each([["#864 ✓", 864], ["◌#21288 ⟳", 21288], ["", null], [undefined, null], ["nope", null]])(
    "parses %p as %p",
    (label, expected) => {
      expect(parsePrNumber(label as string | undefined)).toBe(expected as number | null);
    },
  );
});

describe("resolvePaneCwd", () => {
  test("prefers cwd over a transient foreground sandbox path", () => {
    expect(resolvePaneCwd({ cwd: "/repo", foreground_cwd: "/tmp/sandbox" })).toBe("/repo");
  });
  test("falls back to foreground_cwd", () => {
    expect(resolvePaneCwd({ foreground_cwd: "/repo" })).toBe("/repo");
  });
  test("no directory at all is undefined, not a guess", () => {
    expect(resolvePaneCwd({})).toBeUndefined();
  });
});
