import { describe, expect, test } from "bun:test";
import {
  BOT_THREADS,
  CONFLICT,
  DRAFT,
  QUEUED,
  parsePrNumber,
  refreshingLabel,
  resolvePaneCwd,
  reviewFromDecision,
  rollupBuckets,
  signalTokens,
  THREADS,
  tokenId,
  tokenLabel,
  tokenStatus,
  type TokenState,
} from "../src/token.ts";

const base: TokenState = {
  number: 1,
  ci: "none",
  review: "none",
  conflict: false,
  unresolvedHuman: 0,
  unresolvedBot: 0,
  isDraft: false,
  isQueued: false,
  isMerged: false,
};

function tok(overrides: Partial<TokenState>): TokenState {
  return { ...base, ...overrides };
}

// Import the glyphs so tests don't break when icons change.
const CI_PASS = tokenStatus(tok({ ci: "pass" }));
const CI_FAIL = tokenStatus(tok({ ci: "fail" }));
const CI_RUN = tokenStatus(tok({ ci: "pending" }));
const REV_REQ = tokenStatus(tok({ review: "review-required" }));

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
    expect(tokenId(tok({ number: 864, ci: "pass" }))).toBe("#864");
  });
  test("draft PR", () => {
    expect(tokenId(tok({ number: 21288, isDraft: true }))).toBe(`${DRAFT}#21288`);
  });
  test("queued PR", () => {
    expect(tokenId(tok({ number: 500, isQueued: true }))).toBe(`${QUEUED}#500`);
  });
});

describe("tokenStatus", () => {
  test("review and CI", () => {
    expect(tokenStatus(tok({ ci: "pass", review: "approved" }))).toBe(`✓ ${CI_PASS}`);
  });
  test("CI only", () => {
    expect(tokenStatus(tok({ ci: "fail" }))).toBe(CI_FAIL);
  });
  test("review only", () => {
    expect(tokenStatus(tok({ review: "changes-requested" }))).toBe("✗");
  });
  test("nothing", () => {
    expect(tokenStatus(tok({}))).toBe("");
  });
  test("review required and pending", () => {
    expect(tokenStatus(tok({ ci: "pending", review: "review-required" }))).toBe(`${REV_REQ} ${CI_RUN}`);
  });
  test("conflict leads", () => {
    expect(tokenStatus(tok({ conflict: true, ci: "fail", review: "changes-requested" }))).toBe(`${CONFLICT} ✗ ${CI_FAIL}`);
  });
  test("conflict alone", () => {
    expect(tokenStatus(tok({ conflict: true }))).toBe(CONFLICT);
  });
  test("unresolved threads", () => {
    expect(tokenStatus(tok({ unresolvedHuman: 3, unresolvedBot: 1, ci: "pass" }))).toBe(`${THREADS}3 ${BOT_THREADS}1 ${CI_PASS}`);
  });
  test("unresolved threads with review", () => {
    expect(tokenStatus(tok({ review: "approved", unresolvedHuman: 2, ci: "pass" }))).toBe(`✓ ${THREADS}2 ${CI_PASS}`);
  });
  test("bot-only threads", () => {
    expect(tokenStatus(tok({ unresolvedBot: 4, ci: "pass" }))).toBe(`${BOT_THREADS}4 ${CI_PASS}`);
  });
  test("all signals", () => {
    expect(tokenStatus(tok({ conflict: true, review: "changes-requested", unresolvedHuman: 2, unresolvedBot: 1, ci: "fail" }))).toBe(`${CONFLICT} ✗ ${THREADS}2 ${BOT_THREADS}1 ${CI_FAIL}`);
  });
  test("queued returns queued", () => {
    expect(tokenStatus(tok({ isQueued: true }))).toBe("queued");
  });
  test("merged returns merged", () => {
    expect(tokenStatus(tok({ isMerged: true }))).toBe("merged");
  });
});

describe("tokenLabel", () => {
  test("combines id and status", () => {
    expect(tokenLabel(tok({ number: 864, ci: "pass", review: "approved" }))).toBe(`#864 ✓ ${CI_PASS}`);
  });
  test("no status means id only", () => {
    expect(tokenLabel(tok({ number: 4 }))).toBe("#4");
  });
  test("draft with CI only", () => {
    expect(tokenLabel(tok({ number: 21288, ci: "pass", isDraft: true }))).toBe(`${DRAFT}#21288 ${CI_PASS}`);
  });
  test("conflict in combined label", () => {
    expect(tokenLabel(tok({ number: 100, conflict: true, ci: "fail" }))).toBe(`#100 ${CONFLICT} ${CI_FAIL}`);
  });
});

describe("signalTokens", () => {
  test("all empty when nothing to report", () => {
    const s = signalTokens(tok({}));
    expect(s.pr_conflict).toBe("");
    expect(s.pr_changes).toBe("");
    expect(s.pr_review).toBe("");
    expect(s.pr_approved).toBe("");
    expect(s.pr_queued).toBe("");
    expect(s.pr_merged).toBe("");
    expect(s.pr_human_threads).toBe("");
    expect(s.pr_bot_threads).toBe("");
    expect(s.pr_ci_pass).toBe("");
    expect(s.pr_ci_fail).toBe("");
    expect(s.pr_ci_run).toBe("");
  });
  test("conflict sets only pr_conflict", () => {
    const s = signalTokens(tok({ conflict: true }));
    expect(s.pr_conflict).toBe(CONFLICT);
  });
  test("approved sets only pr_approved", () => {
    const s = signalTokens(tok({ review: "approved" }));
    expect(s.pr_approved).toBe("✓");
    expect(s.pr_changes).toBe("");
    expect(s.pr_review).toBe("");
  });
  test("changes requested sets only pr_changes", () => {
    const s = signalTokens(tok({ review: "changes-requested" }));
    expect(s.pr_changes).toBe("✗");
    expect(s.pr_approved).toBe("");
    expect(s.pr_review).toBe("");
  });
  test("review required sets only pr_review", () => {
    const s = signalTokens(tok({ review: "review-required" }));
    expect(s.pr_review).toBe(REV_REQ);
    expect(s.pr_approved).toBe("");
    expect(s.pr_changes).toBe("");
  });
  test("human threads set pr_human_threads with count", () => {
    const s = signalTokens(tok({ unresolvedHuman: 5 }));
    expect(s.pr_human_threads).toBe(`${THREADS}5`);
    expect(s.pr_bot_threads).toBe("");
  });
  test("bot threads set pr_bot_threads with count", () => {
    const s = signalTokens(tok({ unresolvedBot: 3 }));
    expect(s.pr_bot_threads).toBe(`${BOT_THREADS}3`);
    expect(s.pr_human_threads).toBe("");
  });
  test("CI pass", () => {
    const s = signalTokens(tok({ ci: "pass" }));
    expect(s.pr_ci_pass).toBe(CI_PASS);
    expect(s.pr_ci_fail).toBe("");
    expect(s.pr_ci_run).toBe("");
  });
  test("CI fail", () => {
    const s = signalTokens(tok({ ci: "fail" }));
    expect(s.pr_ci_fail).toBe(CI_FAIL);
    expect(s.pr_ci_pass).toBe("");
  });
  test("CI pending", () => {
    const s = signalTokens(tok({ ci: "pending" }));
    expect(s.pr_ci_run).toBe(CI_RUN);
    expect(s.pr_ci_pass).toBe("");
  });
  test("queued sets only pr_queued", () => {
    const s = signalTokens(tok({ isQueued: true }));
    expect(s.pr_queued).toBe(QUEUED);
    expect(s.pr_conflict).toBe("");
    expect(s.pr_ci_pass).toBe("");
  });
  test("all signals at once", () => {
    const s = signalTokens(tok({ conflict: true, review: "changes-requested", unresolvedHuman: 2, unresolvedBot: 1, ci: "fail" }));
    expect(s.pr_conflict).toBe(CONFLICT);
    expect(s.pr_changes).toBe("✗");
    expect(s.pr_human_threads).toBe(`${THREADS}2`);
    expect(s.pr_bot_threads).toBe(`${BOT_THREADS}1`);
    expect(s.pr_ci_fail).toBe(CI_FAIL);
    expect(s.pr_approved).toBe("");
    expect(s.pr_review).toBe("");
    expect(s.pr_ci_pass).toBe("");
    expect(s.pr_ci_run).toBe("");
  });
});

describe("refreshingLabel", () => {
  test("keeps the number and swaps only the glyph", () => {
    expect(refreshingLabel("#864 ✓")).toBe("#864 ⟳");
  });
  test("recovers the number through a draft marker", () => {
    expect(refreshingLabel(`${DRAFT}#864 ✗`, true)).toBe(`${DRAFT}#864 ⟳`);
  });
  test("no previous label means nothing to keep on screen", () => {
    expect(refreshingLabel(undefined)).toBeNull();
    expect(refreshingLabel("")).toBeNull();
  });
});

describe("parsePrNumber", () => {
  test.each([["#864 ✓", 864], [`${DRAFT}#21288 ⟳`, 21288], ["", null], [undefined, null], ["nope", null]])(
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
