import { defineConfig } from "tsup";

// Bundle self-contained: paket workspace (@sahabat-kreator/*) ikut dibundel
// karena entrypoint mereka menunjuk ke sumber TypeScript. Dependensi npm
// sungguhan (@modelcontextprotocol/sdk, zod) tetap eksternal dan di-resolve
// dari node_modules saat runtime — server dijalankan dari dalam repo.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  noExternal: [/^@sahabat-kreator\//],
});
