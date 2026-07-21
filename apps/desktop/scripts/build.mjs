import { build } from 'esbuild';

// Bundle the Electron main process together with @roleagent/server and
// @roleagent/shared (resolved from their built dist/), so the packaged app
// does not depend on pnpm workspace links at runtime. Only electron and
// @prisma/client stay external and are resolved from node_modules.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['electron', '@prisma/client'],
  banner: {
    // Bundled CommonJS dependencies (fastify etc.) need a `require` shim
    // when emitted as ESM.
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
