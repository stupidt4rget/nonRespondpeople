CREATE TABLE "PromptPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" DATETIME,
    "warningsJson" TEXT,
    "ignoredFieldsJson" TEXT,
    "originalFileName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PromptPresetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "identifier" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "marker" BOOLEAN NOT NULL DEFAULT false,
    "injectionPosition" TEXT,
    "injectionDepth" INTEGER,
    "injectionOrder" INTEGER,
    "rawMetadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptPresetEntry_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "PromptPreset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PromptPreset_isActive_idx" ON "PromptPreset"("isActive");
CREATE INDEX "PromptPreset_updatedAt_idx" ON "PromptPreset"("updatedAt");
CREATE INDEX "PromptPresetEntry_presetId_orderIndex_idx" ON "PromptPresetEntry"("presetId", "orderIndex");
