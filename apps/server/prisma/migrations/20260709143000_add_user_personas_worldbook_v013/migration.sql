-- Add V0.13 user personas and per-conversation binding.
CREATE TABLE "UserPersona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

ALTER TABLE "Conversation" ADD COLUMN "userPersonaId" TEXT REFERENCES "UserPersona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "UserPersona_enabled_idx" ON "UserPersona"("enabled");
CREATE INDEX "UserPersona_updatedAt_idx" ON "UserPersona"("updatedAt");
CREATE INDEX "Conversation_userPersonaId_idx" ON "Conversation"("userPersonaId");
