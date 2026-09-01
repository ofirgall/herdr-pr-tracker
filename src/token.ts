// The sidebar token, inherited from the gh-pr plugin this one replaces.
//
// It answers a different question from the pane: "what is the PR for the branch
// in *this* pane?" rather than "what is the state of everything I have open?".
// Both surfaces use the same glyphs so they can never appear to disagree.

/** Buckets `gh pr checks --json bucket` reports. */
export type Bucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

export type TokenCi = "pass" | "fail" | "pending" | "none";

export type TokenReview = "approved" | "changes-requested" | "review-required" | "none";

/**
 * Collapse gh's per-check buckets into one, worst news first.
 *
 * `cancel` is not a failure — the same rule the pane applies to CANCELLED
 * conclusions. This is a deliberate divergence from gh-pr, which treated a
 * cancelled run as red; a cancelled run is nearly always one you superseded.
 */
export function rollupBuckets(buckets: string[]): TokenCi {
  if (buckets.length === 0) return "none";
  const set = new Set(buckets);
  if (set.has("fail")) return "fail";
  if (set.has("pending")) return "pending";
  if (set.has("pass")) return "pass";
  // Everything was skipped or cancelled: no news, rather than a claimed pass.
  return "none";
}

export function reviewFromDecision(decision: string | null): TokenReview {
  switch (decision) {
    case "APPROVED": return "approved";
    case "CHANGES_REQUESTED": return "changes-requested";
    case "REVIEW_REQUIRED": return "review-required";
    default: return "none";
  }
}

const CI_GLYPH: Record<TokenCi, string> = {
  pass: "✓",
  fail: "✗",
  pending: "●",
  none: "",
};

const REVIEW_GLYPH: Record<TokenReview, string> = {
  approved: "✓",
  "changes-requested": "✗",
  "review-required": "◆",
  none: "",
};

/** Shown in place of the CI glyph while a lookup is in flight, so the sidebar
 * visibly acknowledges the work instead of appearing stuck. */
export const REFRESHING = "⟳";
export const DRAFT = "◌";

export const CONFLICT = "⊘";
export const THREADS = "⚑";

export interface TokenState {
  number: number;
  ci: TokenCi;
  review: TokenReview;
  conflict: boolean;
  unresolved: number;
  isDraft: boolean;
}

/** `◌#21288` — draft marker and number. */
export function tokenId(s: TokenState): string {
  return `${s.isDraft ? DRAFT : ""}#${s.number}`;
}

/** `⊘ ✗ ⚑3 ✓` — conflict, review, threads, CI — same order as the pane. */
export function tokenStatus(s: TokenState): string {
  const parts: string[] = [];
  if (s.conflict) parts.push(CONFLICT);
  const r = REVIEW_GLYPH[s.review];
  if (r) parts.push(r);
  if (s.unresolved > 0) parts.push(`${THREADS}${s.unresolved}`);
  const c = CI_GLYPH[s.ci];
  if (c) parts.push(c);
  return parts.join(" ");
}

/** Legacy combined label: `◌#21288 ✓ ✓`. */
export function tokenLabel(s: TokenState): string {
  const status = tokenStatus(s);
  const id = tokenId(s);
  return status ? `${id} ${status}` : id;
}

/**
 * Per-signal tokens for colored sidebar rendering. Each token is either set to
 * its glyph or empty, so the sidebar config can assign a fixed color per token.
 */
export const SIGNAL_TOKENS = [
  "pr_conflict",
  "pr_changes",
  "pr_review",
  "pr_threads",
  "pr_approved",
  "pr_ci_pass",
  "pr_ci_fail",
  "pr_ci_run",
] as const;

export type SignalTokenName = typeof SIGNAL_TOKENS[number];

export function signalTokens(s: TokenState): Record<SignalTokenName, string> {
  return {
    pr_conflict: s.conflict ? CONFLICT : "",
    pr_changes: s.review === "changes-requested" ? REVIEW_GLYPH["changes-requested"] : "",
    pr_review: s.review === "review-required" ? REVIEW_GLYPH["review-required"] : "",
    pr_approved: s.review === "approved" ? REVIEW_GLYPH["approved"] : "",
    pr_threads: s.unresolved > 0 ? `${THREADS}${s.unresolved}` : "",
    pr_ci_pass: s.ci === "pass" ? CI_GLYPH["pass"] : "",
    pr_ci_fail: s.ci === "fail" ? CI_GLYPH["fail"] : "",
    pr_ci_run: s.ci === "pending" ? CI_GLYPH["pending"] : "",
  };
}

/** Keep the number on screen while a refresh runs; only the glyph changes. */
export function refreshingLabel(previous: string | undefined, isDraft = false): string | null {
  const n = parsePrNumber(previous);
  if (n == null) return null;
  return `${isDraft ? DRAFT : ""}#${n} ${REFRESHING}`;
}

/** Recover the PR number from a label we previously wrote. */
export function parsePrNumber(label: string | null | undefined): number | null {
  const m = label?.match(/#(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Which working directory to ask git about.
 *
 * Prefer `cwd` — the shell's directory, i.e. the project root the pane was
 * launched in — over `foreground_cwd`, which for an agent like Claude Code can
 * be a transient sandbox path with no git repo in it at all.
 */
export function resolvePaneCwd(pane: { cwd?: string; foreground_cwd?: string }): string | undefined {
  return pane.cwd ?? pane.foreground_cwd;
}
