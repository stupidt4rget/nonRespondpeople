-- V0.16: per-feature enablement persisted as JSON on InstalledExtension.
ALTER TABLE "InstalledExtension" ADD COLUMN "featureSettingsJson" TEXT NOT NULL DEFAULT '{}';
