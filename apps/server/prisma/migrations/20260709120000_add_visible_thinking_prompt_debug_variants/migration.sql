-- Add V0.12 generation transparency, persistent LLM settings, and assistant variants.
ALTER TABLE "GenerationSettings" ADD COLUMN "visibleThinkingEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ChatMessage" ADD COLUMN "thinkingContent" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "rawContent" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "timingJson" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "promptDebugJson" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "selectedVariantId" TEXT;

CREATE TABLE "AssistantMessageVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "thinkingContent" TEXT,
    "rawContent" TEXT,
    "timingJson" TEXT,
    "generationSettingsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessageVariant_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantMessageVariant_messageId_createdAt_idx" ON "AssistantMessageVariant"("messageId", "createdAt");

CREATE TABLE "LlmSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
