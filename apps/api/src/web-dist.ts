import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The built web app to serve beside the API on a single-host deploy, or null when it has not been
 * built - then the API serves only /api, as on Render where the pages are their own static site.
 * Defaults to apps/web/dist, which is two levels up from both src/server.ts and dist/server.js.
 */
export function findWebDist(override: string | undefined, moduleUrl: string): string | null {
  const dir = override ? resolve(override) : resolve(dirname(fileURLToPath(moduleUrl)), "../../web/dist");
  return existsSync(join(dir, "index.html")) ? dir : null;
}
