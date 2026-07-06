-- CreateTable
CREATE TABLE "PromptSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleplayPreset" TEXT NOT NULL,
    "userPersona" TEXT,
    "authorsNote" TEXT,
    "userName" TEXT NOT NULL,
    "maxPromptChars" INTEGER NOT NULL,
    "historyBudgetChars" INTEGER NOT NULL,
    "worldBookBudgetChars" INTEGER NOT NULL,
    "worldBookScanDepth" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
