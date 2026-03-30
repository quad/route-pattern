# @quad/route-pattern

[![JSR Version](https://img.shields.io/jsr/v/%40quad/route-pattern)](https://jsr.io/@quad/route-pattern)

Generate and match URLs from the same route pattern — typesafe path params,
built on [`URLPattern`][urlpattern], zero dependencies.

## Install

```sh
deno add jsr:@quad/route-pattern
```

For [other runtimes](https://jsr.io/docs/with/node):

```sh
bunx jsr add @quad/route-pattern   # bun
npx jsr add @quad/route-pattern    # npm
pnpm add jsr:@quad/route-pattern   # pnpm
yarn add jsr:@quad/route-pattern   # yarn
```

## Quick start

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

// Generate a URL
const url = USER.url("https://api.example.com/", { id: "42" });
assertEquals(url, "https://api.example.com/users/42");

// Match it back
assertEquals(USER.exec(url), { id: "42" });
```

TypeScript catches missing or misspelled params at compile time:

```typescript ignore
USER.url("https://api.example.com/", {});
//                                   ^^ Error: Property 'id' is missing
```

## Generate URLs

### `.url(base, params, query?)`

Produces a full URL. `:param` placeholders are substituted and percent-encoded.

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

assertEquals(
  USER.url("https://api.example.com/", { id: "42" }),
  "https://api.example.com/users/42",
);

assertEquals(
  USER.url("https://api.example.com/", { id: "42" }, { page: "2" }),
  "https://api.example.com/users/42?page=2",
);
```

Base URLs with sub-paths **must** end with `/` — otherwise [`new URL()`][url]
replaces the last segment instead of appending:

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const ITEMS = new RoutePattern("items/123");

assertEquals(
  ITEMS.url("https://example.com/api/v2/"),
  "https://example.com/api/v2/items/123",
);

assertEquals(
  ITEMS.url("https://example.com/api/v2"),
  "https://example.com/api/items/123", // "v2" is gone!
);
```

### `.path(params, query?)`

Produces just the path (plus query string if any). Useful for `<a href>`
attributes or client-side navigation.

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");
assertEquals(USER.path({ id: "42" }), "users/42");

const API_USER = new RoutePattern("/api/users/:id");
assertEquals(API_USER.path({ id: "42" }), "/api/users/42");
```

**Note:** suffix patterns produce bare paths (`"users/42"`, not `"/users/42"`),
which resolve relative to the current page URL. Use an exact pattern or `.url()`
for a rooted path.

## Match URLs

### What `.exec` and `.test` accept

`.exec()` accepts full URLs, absolute paths, and bare relative paths. Returns
extracted path params on match (`{}` if the pattern has none), or `null` on
failure — it never throws.

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

assertEquals(USER.exec("https://example.com/users/42"), { id: "42" });
assertEquals(USER.exec("/users/42"), { id: "42" });
assertEquals(USER.exec("users/42"), { id: "42" });
```

`.test()` is the boolean version:

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

assertEquals(USER.test("https://example.com/users/42"), true);
assertEquals(USER.test("https://example.com/posts/42"), false);
```

### Suffix patterns

A pattern without a leading `/` matches any URL whose path ends with the pattern
on a **segment boundary**:

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

assertEquals(
  USER.exec("https://any-host.com/prefix/users/42"),
  { id: "42" },
);

assertEquals(
  USER.exec("https://example.com/xusers/42"),
  null, // no segment boundary before "users"
);
```

### Exact patterns

A pattern with a leading `/` requires the full pathname to match:

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const API_USER = new RoutePattern("/api/users/:id");

assertEquals(API_USER.exec("https://example.com/api/users/42"), { id: "42" });
assertEquals(API_USER.exec("https://example.com/v2/api/users/42"), null);
```

Use exact patterns when the full path is known; suffix patterns when the prefix
varies.

### Anchoring to a base pathname

Pass a pathname as the second argument to `.exec()` to narrow a suffix pattern.
The URL's path must start with that prefix:

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const USER = new RoutePattern("users/:id");

assertEquals(USER.exec("https://example.com/v2/users/42", "/v2/"), {
  id: "42",
});
assertEquals(USER.exec("https://example.com/v1/users/42", "/v2/"), null);
```

The base is a pathname — only the path is checked, not the host. It should end
with `/`.

## Query parameters

The constructor's second argument defines query params that are part of the
route, just like `:id` is a path param.

On generation, they are always included and override same-named caller-supplied
keys. On matching, they must be present with exact values.

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals } from "jsr:@std/assert";

const SEARCH = new RoutePattern("search", { format: "json" });

// Generation
assertEquals(
  SEARCH.url("https://example.com/", { q: "hello" }),
  "https://example.com/search?q=hello&format=json",
);

assertEquals(
  SEARCH.url("https://example.com/", { format: "csv" }),
  "https://example.com/search?format=json", // route query wins
);

// Matching
assertEquals(SEARCH.exec("https://example.com/search?q=hello&format=json"), {});
assertEquals(SEARCH.exec("https://example.com/search?q=hello"), null); // missing format=json
```

## Edge cases

```typescript
import { RoutePattern } from "@quad/route-pattern";
import { assertEquals, assertThrows } from "jsr:@std/assert";

// Invalid param names throw at construction time
assertThrows(
  () => new RoutePattern("users/:foo-bar"),
  Error,
  "Invalid param name",
);
assertThrows(
  () => new RoutePattern("files/(*)"),
  Error,
  "Invalid route pathname",
);

// Trailing slashes are tolerated
const USER = new RoutePattern("users/:id");
assertEquals(USER.exec("https://example.com/users/42/"), { id: "42" });

// Malformed percent-encoding is preserved as-is
assertEquals(USER.exec("https://example.com/users/%zz"), { id: "%zz" });

// Unparseable URLs return null, never throw
assertEquals(USER.exec("not a url"), null);
```

## License

Apache-2.0

[urlpattern]: https://developer.mozilla.org/en-US/docs/Web/API/URLPattern
[url]: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
