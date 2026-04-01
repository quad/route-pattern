// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Substrate AI, Inc.

/**
 * Generate and match URLs from the same route pattern — typesafe path params,
 * built on {@link https://developer.mozilla.org/en-US/docs/Web/API/URLPattern | URLPattern},
 * zero dependencies.
 *
 * @module
 */

/** Extracts the union of path parameter names from a route pattern string. */
export type ExtractPathParams<T extends string> = T extends
  `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractPathParams<`/${Rest}`>
  : T extends `${string}:${infer Param}` ? Param
  : never;

/**
 * Arguments to `.url()` and `.path()` after the base. When the pattern has
 * `:param` placeholders, `params` is required; otherwise the signature
 * collapses to just an optional `query` argument.
 */
export type RouteParams<P extends string> = [ExtractPathParams<P>] extends
  [never] ? [query?: Record<string, string>]
  : [
    params: { [K in ExtractPathParams<P>]: string },
    query?: Record<string, string>,
  ];

/** Return type of `.exec()` — extracted path params or `null`. */
export type RouteMatch<P extends string> =
  | { [K in ExtractPathParams<P>]: string }
  | null;

// Two regexes, aligned by construction:
// - COLON_SEGMENT_RE finds every `:segment` (greedy to the next `/` or end).
// - PARAM_NAME_RE validates each captured name is a valid JS identifier.
// The constructor rejects any mismatch, so after construction every colon
// segment is a valid param. This guarantees COLON_SEGMENT_RE is safe to use
// for both validation and substitution.
//
// The type-level ExtractPathParams infers greedily to the next `/`, so it
// would accept `:foo-bar` as `"foo-bar"` while COLON_SEGMENT_RE captures
// `"foo-bar"` in full — which then fails PARAM_NAME_RE. The two layers
// agree by construction.
const PARAM_NAME_RE = /^[a-zA-Z_]\w*$/;
const COLON_SEGMENT_RE = /:([^/]*)/g;
const NO_BASE = new URL("http://n");

/**
 * Generate and match URLs from the same route pattern — typesafe path params,
 * built on {@link https://developer.mozilla.org/en-US/docs/Web/API/URLPattern | URLPattern},
 * zero dependencies.
 *
 * TypeScript catches missing or misspelled params at compile time. Constructor
 * query params are always included on generation (overriding same-named
 * caller-supplied keys) and must be present with exact values on matching.
 *
 * A leading `/` requires the full pathname to match (exact). Without it, the
 * pattern matches any URL whose path ends with it on a segment boundary
 * (suffix). Pass a pathname prefix to `.exec()` to anchor a suffix pattern.
 *
 * @example Generate and match a URL
 * ```ts
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const USER = new RoutePattern("users/:id");
 * const url = USER.url("https://api.example.com/", { id: "42" });
 * assertEquals(url, "https://api.example.com/users/42");
 * assertEquals(USER.exec(url), { id: "42" });
 * ```
 *
 * @example Exact pathname matching
 * ```ts
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const API_USER = new RoutePattern("/api/users/:id");
 * assertEquals(API_USER.exec("https://example.com/api/users/42"), { id: "42" });
 * assertEquals(API_USER.exec("https://example.com/v2/api/users/42"), null);
 * ```
 *
 * @example Route query wins
 * ```ts
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const SEARCH = new RoutePattern("search", { format: "json" });
 * assertEquals(
 *   SEARCH.url("https://a.com/", { format: "csv" }),
 *   "https://a.com/search?format=json",
 * );
 * ```
 */
export class RoutePattern<const P extends string> {
  private readonly anchor: "/" | undefined;
  private readonly searchEntries: readonly [string, string][];
  private readonly hasPathParams: boolean;
  private readonly pathname: P;
  private readonly suffixPattern: URLPattern;

  /**
   * @param pathname - URL path pattern with optional `:param` placeholders.
   *   A leading `/` anchors to the root for exact pathname matching; without
   *   it, the pattern matches any URL whose path ends with it on a segment
   *   boundary (suffix match). Param names must be valid JS identifiers.
   * @param query - Query params that are part of this route. Always included
   *   when generating URLs; must be present with exact values when matching.
   */
  constructor(
    pathname: P,
    query: Record<string, string> = {},
  ) {
    this.hasPathParams = false;
    for (const [, name] of pathname.matchAll(COLON_SEGMENT_RE)) {
      this.hasPathParams = true;
      if (!PARAM_NAME_RE.test(name)) {
        throw new Error(
          `Invalid param name ":${name}" in pathname: ${pathname} ` +
            "Param names must be valid JS identifiers (e.g. :userId, :first_name)",
        );
      }
    }
    this.pathname = pathname;
    this.searchEntries = Object.entries(query);
    const absolute = pathname.startsWith("/");
    this.anchor = absolute ? "/" : undefined;
    const bare = absolute ? pathname.slice(1) : pathname;
    try {
      this.suffixPattern = new URLPattern({ pathname: `*/${bare}{/}?` });
    } catch (cause) {
      throw new Error(`Invalid route pathname: ${pathname}`, { cause });
    }
  }

  /** Substitute `:param` placeholders with percent-encoded values. */
  private resolvePath(params: Record<string, string>): string {
    return this.pathname.replace(
      COLON_SEGMENT_RE,
      (_, key) => encodeURIComponent(params[key]),
    );
  }

  /** Build a query string from caller-supplied `query` and route query params (route params win). */
  private buildSearchString(query?: Record<string, string>): string {
    const params = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        params.set(key, value);
      }
    }
    // Route query params always win — they're part of the route's identity.
    for (const [key, value] of this.searchEntries) {
      params.set(key, value);
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  }

  /**
   * Produce a full URL. `:param` placeholders are substituted and
   * percent-encoded.
   *
   * Base URLs with sub-paths **must** end with `/` — otherwise
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/URL/URL | `new URL()`}
   * replaces the last segment instead of appending.
   *
   * @example Basic usage
   * ```ts
   * import { assertEquals } from "jsr:@std/assert";
   *
   * const USER = new RoutePattern("users/:id");
   * assertEquals(
   *   USER.url("https://api.example.com/", { id: "42" }),
   *   "https://api.example.com/users/42",
   * );
   * assertEquals(
   *   USER.url("https://api.example.com/", { id: "42" }, { page: "2" }),
   *   "https://api.example.com/users/42?page=2",
   * );
   * ```
   */
  url(base: string, ...args: RouteParams<P>): string {
    return new URL(this.path(...args), base).toString();
  }

  /**
   * Produce just the path (plus query string if any). Useful for `<a href>`
   * attributes or client-side navigation.
   *
   * Suffix patterns produce bare paths (`"users/42"`, not `"/users/42"`),
   * which resolve relative to the current page URL. Use an exact pattern or
   * `.url()` for a rooted path.
   *
   * @example Suffix vs. exact output
   * ```ts
   * import { assertEquals } from "jsr:@std/assert";
   *
   * const USER = new RoutePattern("users/:id");
   * assertEquals(USER.path({ id: "42" }), "users/42");
   *
   * const ABS = new RoutePattern("/api/users/:id");
   * assertEquals(ABS.path({ id: "42" }), "/api/users/42");
   * ```
   */
  path(...args: RouteParams<P>): string {
    const [params = {}, query] = this.hasPathParams ? args : [{}, args[0]];
    return this.resolvePath(params) + this.buildSearchString(query);
  }

  /**
   * Extract path params on match (`{}` if the pattern has none), or `null` on
   * failure — never throws.
   *
   * Accepts full URLs, absolute paths, and bare relative paths. Trailing
   * slashes are tolerated. Malformed percent-encoding is preserved as-is.
   * Unparseable URLs return `null`.
   *
   * @example Matching different input formats
   * ```ts
   * import { assertEquals } from "jsr:@std/assert";
   *
   * const USER = new RoutePattern("users/:id");
   * assertEquals(USER.exec("https://example.com/users/42"), { id: "42" });
   * assertEquals(USER.exec("/users/42"), { id: "42" });
   * assertEquals(USER.exec("users/42"), { id: "42" });
   * assertEquals(USER.exec("https://example.com/posts/42"), null);
   * ```
   */
  exec(url: string): RouteMatch<P>;
  /**
   * Match a URL anchored to a pathname prefix. The URL's path must start
   * with `base`. Only the path is checked, not the host. Base should end
   * with `/`.
   *
   * @example Anchored matching
   * ```ts
   * import { assertEquals } from "jsr:@std/assert";
   *
   * const USER = new RoutePattern("users/:id");
   * assertEquals(USER.exec("https://example.com/v2/users/42", "/v2/"), { id: "42" });
   * assertEquals(USER.exec("https://example.com/v1/users/42", "/v2/"), null);
   * ```
   */
  exec(url: string, base: string): RouteMatch<P>;
  exec(...args: [string] | [string, string]): RouteMatch<P> {
    const [urlStr, baseStr] = args;

    // Parse the URL — bare relatives like "users/42" resolve against NO_BASE.
    if (!URL.canParse(urlStr, NO_BASE)) return null;
    const { pathname, search } = new URL(urlStr, NO_BASE);

    // Route query params must be present in the query string (cheap, skipped when none).
    if (this.searchEntries.length) {
      const sp = new URLSearchParams(search);
      if (!this.searchEntries.every(([k, v]) => sp.get(k) === v)) return null;
    }

    // Pathname must end with this route's pattern.
    const result = this.suffixPattern.exec({ pathname });
    if (!result) return null;

    // Anchor check: exact patterns anchor to "/", base match anchors to the
    // base pathname, suffix match (undefined) skips the check entirely.
    const { "0": prefix, ...groups } = result.pathname.groups as Record<
      string,
      string
    >;
    const anchor = baseStr !== undefined ? baseStr : this.anchor;
    if (anchor && `${prefix}/` !== anchor) return null;

    // Decode percent-encoded param values; preserve malformed sequences as-is.
    for (const key in groups) {
      try {
        groups[key] = decodeURIComponent(groups[key]);
      } catch { /* ok */ }
    }
    return groups as RouteMatch<P>;
  }

  /** Boolean version of `.exec()`. */
  test(url: string): boolean;
  /** Boolean version of `.exec()`. Anchors to a pathname prefix. */
  test(url: string, base: string): boolean;
  test(...args: [string] | [string, string]): boolean {
    return this.exec(...(args as [string, string])) !== null;
  }
}
