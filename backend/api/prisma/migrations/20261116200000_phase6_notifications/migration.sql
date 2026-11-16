-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REPORT_SUBMITTED', 'REPORT_ACCEPTED', 'REPORT_REJECTED', 'REPORT_DELAYED', 'REPAIR_STARTED', 'REPAIR_UPDATED', 'REPAIR_CONFIRMED', 'NEW_REPORT', 'AI_ANALYSIS_FAILED', 'REPAIR_AWAITING_CONFIRMATION', 'JOB_ASSIGNED', 'JOB_REASSIGNED', 'REWORK_REQUESTED', 'CHAT_MESSAGE');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "report_id" UUID,
    "conversation_id" UUID,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

