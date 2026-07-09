-- CreateTable
CREATE TABLE "GenerationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contextUnlockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contextLimitTokens" INTEGER NOT NULL DEFAULT 200000,
    "maxReplyTokens" INTEGER NOT NULL DEFAULT 65536,
    "responseCount" INTEGER NOT NULL DEFAULT 1,
    "streamEnabled" BOOLEAN NOT NULL DEFAULT true,
    "temperature" REAL NOT NULL DEFAULT 1,
    "frequencyPenalty" REAL NOT NULL DEFAULT 0,
    "presencePenalty" REAL NOT NULL DEFAULT 0,
    "topP" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
