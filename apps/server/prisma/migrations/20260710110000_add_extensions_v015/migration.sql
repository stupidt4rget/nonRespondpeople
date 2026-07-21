-- Add the V0.15 extension-management registry. Extension files remain in the
-- controlled runtime data directory and are never stored in the database.
CREATE TABLE "InstalledExtension" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "author" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'zip',
    "sourceUrl" TEXT,
    "manifestJson" TEXT NOT NULL,
    "installedPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "InstalledExtension_packageName_key" ON "InstalledExtension"("packageName");
CREATE INDEX "InstalledExtension_enabled_idx" ON "InstalledExtension"("enabled");
CREATE INDEX "InstalledExtension_updatedAt_idx" ON "InstalledExtension"("updatedAt");
