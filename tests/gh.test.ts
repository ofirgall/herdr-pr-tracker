import { describe, expect, test } from "bun:test";
import { classify } from "../src/gh.ts";
import { type IgnoreEntry, inboundArgs, searchArgs } from "../src/query.ts";

// The header has room for a few words, and "offline" versus "auth failed" is
// the difference between waiting and going to fix something.
describe("classify", () => {
  test.each([
    ["gh: To get started with GitHub CLI, please run: gh auth login", "auth", "auth failed"],
    ["HTTP 401: Bad credentials", "auth", "auth failed"],
    ["API rate limit exceeded for user ID 1", "rate", "rate limited"],
    ["You have exceeded a secondary rate limit", "rate", "rate limited"],
    ["dial tcp: lookup api.github.com: no such host", "network", "offline"],
    ["Post \"https://api.github.com/graphql\": i/o timeout", "network", "offline"],
    ["connection refused", "network", "offline"],
    ["HTTP 403: Resource not accessible", "rate", "forbidden"],
  ])("%s -> %s", (stderr, kind, message) => {
    const e = classify(stderr as string);
    expect(e.kind).toBe(kind as never);
    expect(e.message).toBe(message as string);
  });

  test("an unrecognised failure keeps its first line, truncated", () => {
    const e = classify("something entirely unexpected happened here and it went on\nsecond line");
    expect(e.kind).toBe("other");
    expect(e.message.length).toBeLessThanOrEqual(40);
    expect(e.message).not.toContain("second line");
  });

  test("empty stderr still produces a reason to show", () => {
    expect(classify("").message).toBe("gh failed");
  });
});

// "A view cannot forget the ignore list" is an invariant the comments in gh.ts
// *state*, and a stated invariant with no test is one that breaks the next time
// a view is added. gh.ts spawns, so it is unreachable from a test — which is why
// the argument lists are built in query.ts. These assert the arguments GitHub
// would actually receive, rather than the source text that produces them: a
// search spelled any other way still has to appear here.
describe("the ignore list reaches every search", () => {
  const IGNORED: IgnoreEntry[] = [
    { kind: "repo", owner: "acme", name: "web-app" },
    { kind: "owner", owner: "initech" },
  ];
  const SUBTRACTED = ["-repo:acme/web-app", "-user:initech"];

  // Variables that are not searches: the GraphQL document itself, page sizes
  // and the thread cap. Everything else is a query going to GitHub. Listing the
  // exceptions rather than the searches is the point — a new search under any
  // name is a search until this set says otherwise.
  const NOT_A_SEARCH_COMMON = new Set(["query", "prs", "threads"]);
  const NOT_A_SEARCH_AUTHORED = new Set([...NOT_A_SEARCH_COMMON, "mergedPrs"]);

  /** The `name=value` pairs in a `gh api graphql` argument list, split into the
   * searches and the rest. */
  const variables = (args: string[], exempt: Set<string>) => {
    const all: Array<{ name: string; value: string }> = [];
    for (let i = 0; i < args.length; i += 2) {
      expect(["-f", "-F"]).toContain(args[i]!);
      const pair = args[i + 1]!;
      const eq = pair.indexOf("=");
      expect(eq).toBeGreaterThan(0);
      all.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1) });
    }
    return { all, searches: all.filter((v) => !exempt.has(v.name)) };
  };

  const REQUESTS: Array<[string, string[], number, Set<string>]> = [
    ["authored", searchArgs("is:pr is:open author:@me", 100, IGNORED, 100), 2, NOT_A_SEARCH_AUTHORED],
    ["inbound", inboundArgs(IGNORED, 100), 3, NOT_A_SEARCH_COMMON],
  ];

  test.each(REQUESTS)("the %s request names the non-searches it exempts", (_n, args, _c, exempt) => {
    // So a renamed `prs`/`threads` shows up as a new search rather than quietly
    // joining the exempt set.
    const { all } = variables(args as string[], exempt as Set<string>);
    for (const name of exempt as Set<string>) {
      expect(all.some((v) => v.name === name)).toBe(true);
    }
  });

  test.each(REQUESTS)("every %s search is sent with the ignore list subtracted", (_n, args, count, exempt) => {
    const { searches } = variables(args as string[], exempt as Set<string>);
    expect(searches.length).toBe(count);
    for (const s of searches) {
      for (const q of SUBTRACTED) expect(s.value).toContain(q);
    }
  });

  test("an empty ignore list subtracts nothing", () => {
    for (const [args, exempt] of [
      [searchArgs("is:pr is:open author:@me", 100, [], 100), NOT_A_SEARCH_AUTHORED],
      [inboundArgs([], 100), NOT_A_SEARCH_COMMON],
    ] as const) {
      for (const s of variables(args as string[], exempt as Set<string>).searches) {
        expect(s.value).not.toContain("-repo:");
        expect(s.value).not.toContain("-user:");
      }
    }
  });

  // That neither fetch *can* be called without an ignore list is not asserted
  // here: `ignore` is a required parameter, so tsc refuses it, which is both
  // stronger than anything written here and the enforcement this repo already
  // leans on elsewhere.
});
