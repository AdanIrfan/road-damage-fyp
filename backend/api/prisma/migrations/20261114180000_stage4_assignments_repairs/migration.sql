-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('PENDING', 'WORKING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RepairUpdateKind" AS ENUM ('STATUS_CHANGE', 'NOTE', 'ADMIN_FEEDBACK');

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "assigned_at" TIMESTAMPTZ(3),
ADD COLUMN     "assigned_engineer_id" UUID,
ADD COLUMN     "repair_attempt" INTEGER,
ADD COLUMN     "repair_status" "RepairStatus",
ADD COLUMN     "repair_status_updated_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "report_assignments" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "previous_engineer_id" UUID,
    "assigned_by_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "attempt" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_updates" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" "RepairUpdateKind" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "from_status" "RepairStatus",
    "to_status" "RepairStatus",
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_photos" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "original_key" VARCHAR(200) NOT NULL,
    "display_key" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_assignments_report_id_created_at_idx" ON "report_assignments"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "report_assignments_engineer_id_idx" ON "report_assignments"("engineer_id");

-- CreateIndex
CREATE INDEX "repair_updates_report_id_created_at_idx" ON "repair_updates"("report_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "repair_photos_original_key_key" ON "repair_photos"("original_key");

-- CreateIndex
CREATE UNIQUE INDEX "repair_photos_display_key_key" ON "repair_photos"("display_key");

-- CreateIndex
CREATE INDEX "repair_photos_report_id_attempt_idx" ON "repair_photos"("report_id", "attempt");

-- CreateIndex
CREATE INDEX "reports_assigned_engineer_id_repair_status_idx" ON "reports"("assigned_engineer_id", "repair_status");

-- CreateIndex
CREATE INDEX "reports_status_repair_status_idx" ON "reports"("status", "repair_status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_engineer_id_fkey" FOREIGN KEY ("assigned_engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_previous_engineer_id_fkey" FOREIGN KEY ("previous_engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_updates" ADD CONSTRAINT "repair_updates_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_updates" ADD CONSTRAINT "repair_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

