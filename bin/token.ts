#!/usr/bin/env bun
// Writes the sidebar `$pr_id` and `$pr_status` tokens for one pane's branch
// and for every workspace with a worktree.

import { join } from "node:path";
import { fetchBranchChecks, fetchBranchPr } from "../src/gh.ts";
import {
  clearToken, clearWorkspaceToken, currentPane, listPanes, listWorkspaces,
  type PaneInfo, setToken, setWorkspaceToken,
} from "../src/herdr.ts";
import { loadConfig } from "../src/config.ts";
import { stateDir } from "../src/state.ts";
import {
  refreshingLabel, resolvePaneCwd, reviewFromDecision, rollupBuckets,
  SIGNAL_TOKENS, signalTokens, tokenId, tokenStatus, type TokenState,
} from "../src/token.ts";

const TOKEN_ID = "pr_id";
const TOKEN_STATUS = "pr_status";
const TOKEN_LEGACY = "pr";

/** The pane the hook fired for. Herdr sets HERDR_PANE_ID on pane-scoped hooks;
 * an action invoked from a workspace context has none, so fall back to asking
 * which pane is focused. */
async function targetPane(): Promise<PaneInfo | null> {
  const id = process.env.HERDR_PANE_ID;
  if (!id) return await currentPane();
  const pane = (await listPanes()).find((p) => p.pane_id === id);
  return pane ?? (await currentPane());
}

async function branchOf(cwd: string): Promise<string | null> {
  const p = Bun.spawn(["git", "-C", cwd, "symbolic-ref", "--short", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out.trim() || null : null;
}

/** Per-pane throttle. Focus events fire far more often than a PR's state
 * changes, and every lookup is two `gh` subprocesses. */
async function throttled(key: string, seconds: number): Promise<boolean> {
  if (seconds <= 0) return false;
  const stamp = join(stateDir(), `throttle-${key.replace(/[^\w.-]/g, "_")}`);
  try {
    const text = await Bun.file(stamp).text();
    const last = Number.parseInt(text.trim(), 10);
    if (Number.isFinite(last) && Date.now() - last < seconds * 1000) return true;
  } catch {
    // No stamp yet: not throttled.
  }
  await Bun.write(stamp, String(Date.now()));
  return false;
}

async function lookupToken(cwd: string, branch: string): Promise<TokenState | null> {
  const pr = await fetchBranchPr(cwd, branch);
  if (!pr || pr.state !== "OPEN") return null;
  const ci = rollupBuckets(await fetchBranchChecks(cwd, branch));
  const review = reviewFromDecision(pr.reviewDecision);
  return {
    number: pr.number,
    ci,
    review,
    conflict: pr.mergeable === "CONFLICTING",
    unresolved: pr.unresolvedThreads,
    isDraft: pr.isDraft,
  };
}

async function setAllPaneTokens(paneId: string, state: TokenState): Promise<void> {
  const signals = signalTokens(state);
  await Promise.all([
    setToken(paneId, TOKEN_ID, tokenId(state)),
    setToken(paneId, TOKEN_STATUS, tokenStatus(state)),
    ...SIGNAL_TOKENS.map((name) =>
      signals[name] ? setToken(paneId, name, signals[name]) : clearToken(paneId, name),
    ),
  ]);
}

async function clearAllPaneTokens(paneId: string): Promise<void> {
  await Promise.all([
    clearToken(paneId, TOKEN_ID),
    clearToken(paneId, TOKEN_STATUS),
    clearToken(paneId, TOKEN_LEGACY),
    ...SIGNAL_TOKENS.map((name) => clearToken(paneId, name)),
  ]);
}

async function setAllWorkspaceTokens(wsId: string, state: TokenState): Promise<void> {
  const signals = signalTokens(state);
  await Promise.all([
    setWorkspaceToken(wsId, TOKEN_ID, tokenId(state)),
    setWorkspaceToken(wsId, TOKEN_STATUS, tokenStatus(state)),
    ...SIGNAL_TOKENS.map((name) =>
      signals[name] ? setWorkspaceToken(wsId, name, signals[name]) : clearWorkspaceToken(wsId, name),
    ),
  ]);
}

async function clearAllWorkspaceTokens(wsId: string): Promise<void> {
  await Promise.all([
    clearWorkspaceToken(wsId, TOKEN_ID),
    clearWorkspaceToken(wsId, TOKEN_STATUS),
    clearWorkspaceToken(wsId, TOKEN_LEGACY),
    ...SIGNAL_TOKENS.map((name) => clearWorkspaceToken(wsId, name)),
  ]);
}

const cfg = await loadConfig(
  process.env.HERDR_PLUGIN_ROOT ?? ".",
  process.env.HERDR_PLUGIN_CONFIG_DIR,
);
const automatic = Boolean(process.env.HERDR_PLUGIN_EVENT_JSON);

// Workspace-level tokens: set $pr_id and $pr_status on every workspace that
// has a worktree.
const workspaces = await listWorkspaces();
await Promise.all(workspaces.map(async (ws) => {
  const id = ws.workspace_id;
  const checkoutPath = ws.worktree?.checkout_path;
  if (!id || !checkoutPath) return;
  if (automatic && (await throttled(`ws-${id}`, cfg.tokenThrottleSeconds))) return;
  const branch = await branchOf(checkoutPath);
  if (!branch) {
    await clearAllWorkspaceTokens(id);
    return;
  }
  const state = await lookupToken(checkoutPath, branch);
  if (!state) {
    await clearAllWorkspaceTokens(id);
    return;
  }
  await setAllWorkspaceTokens(id, state);
}));

const pane = await targetPane();
if (!pane) process.exit(0);

const cwd = resolvePaneCwd(pane);
if (!cwd) process.exit(0);

// Only agent panes carry the sidebar row this token appears in, so a plain
// shell pane is not worth two gh calls.
if (!pane.agent) process.exit(0);

if (automatic && (await throttled(pane.pane_id, cfg.tokenThrottleSeconds))) {
  process.exit(0);
}

const branch = await branchOf(cwd);
if (!branch) {
  await clearAllPaneTokens(pane.pane_id);
  process.exit(0);
}

// Keep the number visible while the lookup runs, so the sidebar shows work in
// progress rather than appearing to hang on a stale glyph.
const pending = refreshingLabel(pane.tokens?.[TOKEN_ID]);
if (pending) await setToken(pane.pane_id, TOKEN_ID, pending);

const state = await lookupToken(cwd, branch);
if (!state) {
  await clearAllPaneTokens(pane.pane_id);
  process.exit(0);
}

await setAllPaneTokens(pane.pane_id, state);
