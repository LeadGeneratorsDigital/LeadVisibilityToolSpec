import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { findWebDist } from "./web-dist";

function repoLike(withIndex: boolean) {
  const root = mkdtempSync(join(tmpdir(), "lvt-web-"));
  mkdirSync(join(root, "apps/api/dist"), { recursive: true });
  mkdirSync(join(root, "apps/web/dist"), { recursive: true });
  if (withIndex) writeFileSync(join(root, "apps/web/dist/index.html"), "<html></html>");
  return { root, serverUrl: pathToFileURL(join(root, "apps/api/dist/server.js")).href };
}

describe("findWebDist", () => {
  it("finds apps/web/dist two levels up from the running server file", () => {
    const { root, serverUrl } = repoLike(true);
    expect(findWebDist(undefined, serverUrl)).toBe(join(root, "apps/web/dist"));
  });

  it("is null when the web app has not been built (no index.html), so only /api is served", () => {
    const { serverUrl } = repoLike(false);
    expect(findWebDist(undefined, serverUrl)).toBeNull();
  });

  it("WEB_DIST overrides the default location", () => {
    const { serverUrl } = repoLike(false);
    const other = mkdtempSync(join(tmpdir(), "lvt-other-"));
    writeFileSync(join(other, "index.html"), "<html></html>");
    expect(findWebDist(other, serverUrl)).toBe(other);
  });
});
