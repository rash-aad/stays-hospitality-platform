import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts', 'src/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // Workspace packages ship TypeScript source, so they are bundled in.
  noExternal: ['@hp/db', '@hp/contracts'],
  clean: true,
  sourcemap: true,
  // CommonJS dependencies pulled in with workspace code (e.g. dotenv) need `require` inside ESM.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
