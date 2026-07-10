-- V0.17: isolated SillyTavern compatibility settings per installed extension.
ALTER TABLE "InstalledExtension" ADD COLUMN "compatSettingsJson" TEXT NOT NULL DEFAULT '{}';
