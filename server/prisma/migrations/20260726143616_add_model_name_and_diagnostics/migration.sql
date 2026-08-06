-- AlterTable
ALTER TABLE "ApiDiagnostics" ADD COLUMN "fileSearchUsed" BOOLEAN;
ALTER TABLE "ApiDiagnostics" ADD COLUMN "finishReason" TEXT;
ALTER TABLE "ApiDiagnostics" ADD COLUMN "generationTimeMs" INTEGER;
ALTER TABLE "ApiDiagnostics" ADD COLUMN "modelName" TEXT;
ALTER TABLE "ApiDiagnostics" ADD COLUMN "queryLength" INTEGER;
ALTER TABLE "ApiDiagnostics" ADD COLUMN "retrievalTimeMs" INTEGER;

-- CreateTable
CREATE TABLE "ThemeToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'color',
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemInstruction" TEXT NOT NULL,
    "fileSearchStoreName" TEXT,
    "modelName" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bot" ("createdAt", "description", "fileSearchStoreName", "id", "name", "systemInstruction", "updatedAt") SELECT "createdAt", "description", "fileSearchStoreName", "id", "name", "systemInstruction", "updatedAt" FROM "Bot";
DROP TABLE "Bot";
ALTER TABLE "new_Bot" RENAME TO "Bot";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ThemeToken_tokenName_key" ON "ThemeToken"("tokenName");
