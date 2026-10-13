import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  // @lvt/shared ships TypeScript source, so plain `node` cannot load it - bundle it in. npm packages stay external.
  noExternal: ["@lvt/shared"],
});
