-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'DELAYED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('LIVE_CAMERA', 'GALLERY_UPLOAD');

-- CreateEnum
CREATE TYPE "LocationVerificationStatus" AS ENUM ('VERIFIED', 'MISMATCH', 'NO_METADATA', 'NOT_CHECKED', 'BROWSER_GPS');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SeverityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "citizen_id" UUID NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "capture_method" "CaptureMethod" NOT NULL,
    "description" VARCHAR(1000),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "gps_accuracy_m" DOUBLE PRECISION,
    "location_status" "LocationVerificationStatus" NOT NULL,
    "location_needs_review" BOOLEAN NOT NULL,
    "exif_latitude" DOUBLE PRECISION,
    "exif_longitude" DOUBLE PRECISION,
    "exif_distance_m" DOUBLE PRECISION,
    "ai_status" "AiAnalysisStatus" NOT NULL,
    "ai_error_code" VARCHAR(40),
    "ai_model" VARCHAR(100),
    "ai_analyzed_at" TIMESTAMPTZ(3),
    "ai_severity" "SeverityLevel",
    "ai_severity_score" DOUBLE PRECISION,
    "admin_severity" "SeverityLevel",
    "admin_severity_by_id" UUID,
    "admin_severity_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_images" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "original_key" VARCHAR(200) NOT NULL,
    "display_key" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_detections" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "image_id" UUID NOT NULL,
    "class_id" INTEGER NOT NULL,
    "class_name" VARCHAR(100) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "x2" DOUBLE PRECISION NOT NULL,
    "y2" DOUBLE PRECISION NOT NULL,
    "area_fraction" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ai_detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_status_history" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "from_status" "ReportStatus",
    "to_status" "ReportStatus" NOT NULL,
    "changed_by_id" UUID,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_citizen_id_created_at_idx" ON "reports"("citizen_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_ai_severity_idx" ON "reports"("ai_severity");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- CreateIndex
CREATE INDEX "reports_latitude_longitude_idx" ON "reports"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "report_images_original_key_key" ON "report_images"("original_key");

-- CreateIndex
CREATE UNIQUE INDEX "report_images_display_key_key" ON "report_images"("display_key");

-- CreateIndex
CREATE INDEX "report_images_report_id_idx" ON "report_images"("report_id");

-- CreateIndex
CREATE INDEX "ai_detections_report_id_idx" ON "ai_detections"("report_id");

-- CreateIndex
CREATE INDEX "ai_detections_image_id_idx" ON "ai_detections"("image_id");

-- CreateIndex
CREATE INDEX "ai_detections_class_name_idx" ON "ai_detections"("class_name");

-- CreateIndex
CREATE INDEX "report_status_history_report_id_created_at_idx" ON "report_status_history"("report_id", "created_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_citizen_id_fkey" FOREIGN KEY ("citizen_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_admin_severity_by_id_fkey" FOREIGN KEY ("admin_severity_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_images" ADD CONSTRAINT "report_images_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_detections" ADD CONSTRAINT "ai_detections_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_detections" ADD CONSTRAINT "ai_detections_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "report_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

