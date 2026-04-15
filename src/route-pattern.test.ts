// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Substrate AI, Inc.

import { assertEquals, assertThrows } from "@std/assert";
import { RoutePattern } from "./route-pattern.ts";

const B = "https://example.com";

Deno.test("RoutePattern construction", async (t) => {
  const invalid: [string, string][] = [
    ["users/:foo-bar", "Invalid param name"],
    ["files/:foo.bar", "Invalid param name"],
    ["items/:123", "Invalid param name"],
    ["items/:", "Invalid param name"],
    ["files/(*)", "Invalid route pathname"],
  ];
  for (const [pattern, err] of invalid) {
    await t.step(`rejects ${JSON.stringify(pattern)}`, () => {
      assertThrows(
        () => new RoutePattern(pattern as string & Record<PropertyKey, never>),
        Error,
        err,
      );
    });
  }
});

Deno.test("RoutePattern.url", async (t) => {
  const cases: [string, () => string, string][] = [
    ["empty pathname", () => new RoutePattern("").url(B), `${B}/`],
    [
      "static, no params",
      () => new RoutePattern("users").url(B),
      `${B}/users`,
    ],
    [
      "path param",
      () => new RoutePattern("users/:id").url(B, { id: "42" }),
      `${B}/users/42`,
    ],
    [
      "multiple path params",
      () =>
        new RoutePattern("users/:id/posts/:postId").url(B, {
          id: "42",
          postId: "7",
        }),
      `${B}/users/42/posts/7`,
    ],
    [
      "explicit query params",
      () => new RoutePattern("users/:id").url(B, { id: "42" }, { page: "2" }),
      `${B}/users/42?page=2`,
    ],
    [
      "query-only (no path params)",
      () => new RoutePattern("items").url(B, {}, { page: "2", limit: "50" }),
      `${B}/items?page=2&limit=50`,
    ],
    [
      "fixed params",
      () => new RoutePattern("search", { format: "json" }).url(B),
      `${B}/search?format=json`,
    ],
    [
      "fixed + query",
      () =>
        new RoutePattern("search", { format: "json" }).url(B, {}, {
          q: "hello",
        }),
      `${B}/search?q=hello&format=json`,
    ],
    [
      "fixed wins over query collision",
      () =>
        new RoutePattern("search", { format: "json" }).url(B, {}, {
          format: "csv",
          extra: "ok",
        }),
      `${B}/search?format=json&extra=ok`,
    ],
    [
      "multiple fixed params",
      () => new RoutePattern("search", { format: "json", lang: "en" }).url(B),
      `${B}/search?format=json&lang=en`,
    ],
    [
      "absolute pattern",
      () => new RoutePattern("/api/users/:id").url(B, { id: "42" }),
      `${B}/api/users/42`,
    ],
  ];
  for (const [name, fn, expected] of cases) {
    await t.step(name, () => assertEquals(fn(), expected));
  }
});

Deno.test("RoutePattern.url base resolution", async (t) => {
  const route = new RoutePattern("users/123");
  const cases: [string, string][] = [
    ["https://example.com/", "https://example.com/users/123"],
    ["https://example.com/api/v2/", "https://example.com/api/v2/users/123"],
    [
      "https://api.example.com/v2/",
      "https://api.example.com/v2/users/123",
    ],
    // Without trailing slash, WHATWG URL resolution replaces the last segment
    [
      "https://example.com/api/v2",
      "https://example.com/api/users/123",
    ],
  ];
  for (const [base, expected] of cases) {
    await t.step(
      `base ${base}`,
      () => assertEquals(route.url(base), expected),
    );
  }
});

Deno.test("RoutePattern.url encoding", async (t) => {
  const route = new RoutePattern("files/:name");
  const cases: [string, string][] = [
    ["hello/world", `${B}/files/hello%2Fworld`],
    ["report?v=2#section", `${B}/files/report%3Fv%3D2%23section`],
    ["100%", `${B}/files/100%25`],
    ["John Doe", `${B}/files/John%20Doe`],
    ["a+b&c=d", `${B}/files/a%2Bb%26c%3Dd`],
  ];
  for (const [input, expected] of cases) {
    await t.step(`encodes ${JSON.stringify(input)}`, () => {
      assertEquals(route.url(B, { name: input }), expected);
    });
  }

  await t.step("round-trips unicode through decodeURIComponent", () => {
    for (const name of ["café☕", "cafe\u0301"]) {
      const encoded = route.url(B, { name }).slice(`${B}/files/`.length);
      assertEquals(decodeURIComponent(encoded), name);
    }
  });
});

Deno.test("RoutePattern.path", async (t) => {
  const cases: [string, () => string, string][] = [
    ["empty pathname", () => new RoutePattern("").path(), ""],
    ["static", () => new RoutePattern("users").path(), "users"],
    [
      "with param",
      () => new RoutePattern("users/:id").path({ id: "42" }),
      "users/42",
    ],
    [
      "fixed only",
      () => new RoutePattern("search", { format: "json" }).path(),
      "search?format=json",
    ],
    [
      "fixed + query",
      () =>
        new RoutePattern("search", { format: "json" }).path({}, { q: "hello" }),
      "search?q=hello&format=json",
    ],
    [
      "absolute pattern",
      () => new RoutePattern("/api/users/:id").path({ id: "42" }),
      "/api/users/42",
    ],
    [
      "encodes path param",
      () => new RoutePattern("files/:name").path({ name: "a/b" }),
      "files/a%2Fb",
    ],
  ];
  for (const [name, fn, expected] of cases) {
    await t.step(name, () => assertEquals(fn(), expected));
  }
});

Deno.test("RoutePattern.exec — relative (suffix match)", async (t) => {
  const cases: [
    string,
    RoutePattern<string>,
    string,
    Record<string, string> | null,
  ][] = [
    // basic matching
    [
      "matches path param",
      new RoutePattern("users/:id"),
      `${B}/users/123`,
      { id: "123" },
    ],
    ["static match", new RoutePattern("health"), `${B}/health`, {}],
    ["empty pathname matches root", new RoutePattern(""), `${B}/`, {}],
    [
      "empty pathname matches nested trailing slash",
      new RoutePattern(""),
      `${B}/any/path/`,
      {},
    ],
    [
      "empty pathname rejects no trailing slash",
      new RoutePattern(""),
      `${B}/notrailing`,
      null,
    ],
    [
      "multi-segment",
      new RoutePattern("api/notes"),
      "https://api.example.com/a/b/api/notes",
      {},
    ],

    // rejects
    ["wrong path", new RoutePattern("users/:id"), `${B}/posts/123`, null],
    [
      "wrong sub-path",
      new RoutePattern("api/notes"),
      "https://api.example.com/other/notes",
      null,
    ],
    [
      "extra trailing segment",
      new RoutePattern("users/:id"),
      `${B}/users/123/extra`,
      null,
    ],
    ["garbage string", new RoutePattern("users/:id"), "not a url", null],

    // trailing chars
    [
      "trailing slash",
      new RoutePattern("users/:id"),
      `${B}/users/123/`,
      { id: "123" },
    ],
    [
      "query string",
      new RoutePattern("users/:id"),
      `${B}/users/123?page=2`,
      { id: "123" },
    ],
    [
      "fragment",
      new RoutePattern("users/:id"),
      `${B}/users/123#section`,
      { id: "123" },
    ],

    // non-absolute URL inputs
    [
      "bare relative path",
      new RoutePattern("users/:id"),
      "users/123",
      { id: "123" },
    ],
    [
      "leading-slash path",
      new RoutePattern("users/:id"),
      "/users/123",
      { id: "123" },
    ],
    [
      "relative with fragment",
      new RoutePattern("users/:id"),
      "/users/123#section",
      { id: "123" },
    ],
    [
      "relative with query + fragment",
      new RoutePattern("users/:id"),
      "/users/123?p=1#section",
      { id: "123" },
    ],
    [
      "bare relative with query",
      new RoutePattern("users/:id"),
      "users/123?page=2",
      { id: "123" },
    ],

    // fixed params
    [
      "fixed match",
      new RoutePattern("search", { format: "json" }),
      `${B}/search?format=json`,
      {},
    ],
    [
      "fixed + extra query",
      new RoutePattern("search", { format: "json" }),
      `${B}/search?format=json&extra=y`,
      {},
    ],
    [
      "fixed mismatch",
      new RoutePattern("search", { format: "json" }),
      `${B}/search?format=xml`,
      null,
    ],
    [
      "fixed missing",
      new RoutePattern("search", { format: "json" }),
      `${B}/search`,
      null,
    ],
    [
      "multi fixed match",
      new RoutePattern("search", { format: "json", lang: "en" }),
      `${B}/search?format=json&lang=en`,
      {},
    ],
    [
      "multi fixed partial",
      new RoutePattern("search", { format: "json", lang: "en" }),
      `${B}/search?format=json`,
      null,
    ],

    [
      "malformed percent-encoding returns raw value",
      new RoutePattern("users/:id"),
      "users/%zz",
      { id: "%zz" },
    ],
  ];
  for (const [name, route, url, expected] of cases) {
    await t.step(name, () => assertEquals(route.exec(url), expected));
  }
});

Deno.test("RoutePattern.exec — absolute (exact pathname match)", async (t) => {
  const cases: [
    string,
    RoutePattern<string>,
    string,
    Record<string, string> | null,
  ][] = [
    [
      "matches exact pathname",
      new RoutePattern("/api/users/:id"),
      `${B}/api/users/42`,
      { id: "42" },
    ],
    [
      "matches bare path",
      new RoutePattern("/api/users/:id"),
      "/api/users/42",
      { id: "42" },
    ],
    [
      "rejects wrong prefix",
      new RoutePattern("/api/users/:id"),
      `${B}/v2/api/users/42`,
      null,
    ],
    [
      "trailing slash",
      new RoutePattern("/api/users/:id"),
      "/api/users/42/",
      { id: "42" },
    ],
    ["static", new RoutePattern("/health"), "/health", {}],
    ["static rejects prefix", new RoutePattern("/health"), "/api/health", null],
  ];
  for (const [name, route, url, expected] of cases) {
    await t.step(name, () => assertEquals(route.exec(url), expected));
  }
});

Deno.test("RoutePattern.exec — base match (anchored)", async (t) => {
  const cases: [
    string,
    RoutePattern<string>,
    string,
    string,
    Record<string, string> | null,
  ][] = [
    [
      "absolute URL match",
      new RoutePattern("api/notes"),
      "https://api.example.com/v2/api/notes",
      "/v2/",
      {},
    ],
    [
      "wrong base prefix",
      new RoutePattern("api/notes"),
      "https://api.example.com/other/api/notes",
      "/v2/",
      null,
    ],
    [
      "extracts params",
      new RoutePattern("users/:id"),
      "https://api.example.com/users/42",
      "/",
      { id: "42" },
    ],
    [
      "fixed params",
      new RoutePattern("search", { format: "json" }),
      `${B}/search?format=json`,
      "/",
      {},
    ],
    [
      "fixed mismatch",
      new RoutePattern("search", { format: "json" }),
      `${B}/search?format=xml`,
      "/",
      null,
    ],
    [
      "base with trailing slash",
      new RoutePattern("reports"),
      "https://api.example.com/v2/reports",
      "/v2/",
      {},
    ],
    [
      "absolute path input",
      new RoutePattern("reports"),
      "/v2/reports",
      "/v2/",
      {},
    ],
    [
      "garbage string returns null",
      new RoutePattern("users/:id"),
      "not a url",
      "/",
      null,
    ],
    [
      "empty pathname exact match",
      new RoutePattern(""),
      `${B}/`,
      "/",
      {},
    ],
    [
      "any host matches (pathname-only check)",
      new RoutePattern("users/:id"),
      "https://b.com/users/42",
      "/",
      { id: "42" },
    ],
  ];
  for (const [name, route, url, base, expected] of cases) {
    await t.step(name, () => assertEquals(route.exec(url, base), expected));
  }
});

Deno.test("RoutePattern.exec returns null for unparseable URL with base", () => {
  const route = new RoutePattern("users/:id");
  assertEquals(route.exec("http://[", "/"), null);
});

Deno.test("Round-trip: url → exec recovers path params", async (t) => {
  const cases: [
    string,
    () => string,
    RoutePattern<string>,
    Record<string, string>,
  ][] = [
    [
      "static",
      () => new RoutePattern("users").url(B),
      new RoutePattern("users"),
      {},
    ],
    [
      "single param",
      () => new RoutePattern("users/:id").url(B, { id: "42" }),
      new RoutePattern("users/:id"),
      { id: "42" },
    ],
    [
      "multiple params",
      () =>
        new RoutePattern("users/:id/posts/:postId").url(B, {
          id: "1",
          postId: "2",
        }),
      new RoutePattern("users/:id/posts/:postId"),
      { id: "1", postId: "2" },
    ],
    [
      "query params ignored by exec",
      () => new RoutePattern("users/:id").url(B, { id: "42" }, { page: "2" }),
      new RoutePattern("users/:id"),
      { id: "42" },
    ],
    [
      "fixed params",
      () => new RoutePattern("search", { format: "json" }).url(B),
      new RoutePattern("search", { format: "json" }),
      {},
    ],
    [
      "fixed + query",
      () =>
        new RoutePattern("search", { format: "json" }).url(B, {}, {
          q: "hello",
        }),
      new RoutePattern("search", { format: "json" }),
      {},
    ],
    [
      "absolute pattern",
      () => new RoutePattern("/users/:id").url(B, { id: "42" }),
      new RoutePattern("/users/:id"),
      { id: "42" },
    ],
  ];
  for (const [name, makeUrl, route, expectedParams] of cases) {
    await t.step(name, () => {
      const url = makeUrl();
      assertEquals(route.exec(url), expectedParams);
      assertEquals(route.exec(url, "/"), expectedParams);
    });
  }

  await t.step("non-root base", () => {
    const base = "https://api.example.com/v2/";
    const route = new RoutePattern("users/:id");
    const url = route.url(base, { id: "42" });
    assertEquals(route.exec(url, "/v2/"), { id: "42" });
  });

  // Special chars in path params: url() encodes, exec() decodes back
  await t.step("special chars in path params", () => {
    const route = new RoutePattern("files/:name");
    for (
      const name of [
        "hello/world",
        "report?v=2",
        "100%",
        "a+b&c=d",
        "café☕",
      ]
    ) {
      const url = route.url(B, { name });
      assertEquals(
        route.exec(url),
        { name },
        `round-trip failed for ${JSON.stringify(name)}`,
      );
    }
  });
});

Deno.test("RoutePattern.test", async (t) => {
  const route = new RoutePattern("users/:id");

  await t.step("suffix match hit", () => {
    assertEquals(route.test(`${B}/users/42`), true);
  });

  await t.step("suffix match miss", () => {
    assertEquals(route.test(`${B}/posts/42`), false);
  });

  await t.step("anchored match hit", () => {
    assertEquals(route.test(`${B}/users/42`, "/"), true);
  });

  await t.step("anchored match miss", () => {
    assertEquals(
      route.test(`${B}/users/42`, "/different/"),
      false,
    );
  });

  const absolute = new RoutePattern("/api/users/:id");

  await t.step("absolute hit", () => {
    assertEquals(absolute.test("/api/users/42"), true);
  });

  await t.step("absolute miss", () => {
    assertEquals(absolute.test("/wrong/users/42"), false);
  });
});

Deno.test("param names: RoutePattern and URLPattern agree", () => {
  const chars = "abcABC_0123-.@$!";
  for (let i = 0; i < 200; i++) {
    const inner = new Uint8Array(4);
    crypto.getRandomValues(inner);
    const name = Array.from(inner, (b) => chars[b % chars.length]).join("");
    const pattern = `items/:${name}`;

    let route: RoutePattern<`items/:${string}`> | null = null;
    try {
      route = new RoutePattern(pattern as `items/:${string}`);
    } catch {
      continue;
    }

    const url = route.url(B, { [name]: "val" });
    assertEquals(
      route.exec(url),
      { [name]: "val" },
      `round-trip failed for param name ${JSON.stringify(name)}`,
    );
  }
});
