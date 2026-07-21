const path = require('node:path');
const fs = require('node:fs');

// With pnpm, the generated Prisma client lives next to the real @prisma/client
// package inside node_modules/.pnpm. electron-builder's dependency collector
// only copies @prisma/client itself, so the generated .prisma/client must be
// mapped into the app's node_modules explicitly.
// require.resolve returns .../node_modules/@prisma/client/default.js;
// walk up to the node_modules directory that contains the generated .prisma.
const prismaClientDir = path.dirname(require.resolve('@prisma/client'));
const generatedPrismaClientDir = path.join(
  path.dirname(path.dirname(prismaClientDir)),
  '.prisma',
  'client',
);

if (!fs.existsSync(generatedPrismaClientDir)) {
  throw new Error(
    `Generated Prisma client not found at ${generatedPrismaClientDir}. ` +
      'Run "pnpm --filter @roleagent/server db:generate" first.',
  );
}

// Use the Electron distribution already downloaded into node_modules by the
// electron package's install script, so packaging does not re-download it
// from GitHub (which times out on this network).
const electronDistDir = path.join(
  path.dirname(require.resolve('electron/package.json')),
  'dist',
);

module.exports = {
  appId: 'local.roleagent.tavern',
  productName: 'RoleAgent Tavern',
  electronDist: fs.existsSync(path.join(electronDistDir, 'electron.exe'))
    ? electronDistDir
    : undefined,
  directories: {
    output: 'release',
  },
  files: [
    'dist/main.js',
    'package.json',
    {
      from: generatedPrismaClientDir,
      to: 'node_modules/.prisma/client',
    },
  ],
  extraResources: [
    {
      from: '../web/dist',
      to: 'web-dist',
    },
    {
      from: '../server/prisma/schema.prisma',
      to: 'server-prisma/schema.prisma',
    },
    {
      from: '../server/prisma/migrations',
      to: 'server-prisma/migrations',
    },
  ],
  asarUnpack: [
    'node_modules/.prisma/client/**',
    'node_modules/@prisma/client/**',
  ],
  win: {
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
    artifactName: 'RoleAgent Tavern V0.9.${ext}',
  },
};
