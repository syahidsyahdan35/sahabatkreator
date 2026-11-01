import { defineConfig } from "tsup";

// Bundle self-contained: paket workspace (@sahabat-kreator/*) ikut dibundel
// karena entrypoint mereka menunjuk ke sumber TypeScript.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  noExternal: [/^@sahabat-kreator\//],
});
