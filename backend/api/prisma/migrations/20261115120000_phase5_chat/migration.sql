-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_engineer_id_idx" ON "conversations"("engineer_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_admin_id_engineer_id_key" ON "conversations"("admin_id", "engineer_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_id_idx" ON "chat_messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_sender_id_client_id_key" ON "chat_messages"("sender_id", "client_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

