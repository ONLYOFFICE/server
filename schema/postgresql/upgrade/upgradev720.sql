DO $$ 
	BEGIN
		BEGIN
			ALTER TABLE "task_result" ADD COLUMN "tenant" varchar(255) COLLATE "default" NOT NULL DEFAULT 'localhost';
			ALTER TABLE "task_result" ALTER COLUMN "tenant" DROP DEFAULT;
			ALTER TABLE "task_result" DROP CONSTRAINT IF EXISTS task_result_pkey;
			ALTER TABLE "task_result" ADD PRIMARY KEY ("tenant", "id");
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'column `tenant` already exists.';
		END;
		
		BEGIN
			ALTER TABLE "doc_changes" ADD COLUMN "tenant" varchar(255) COLLATE "default" NOT NULL DEFAULT 'localhost';
			ALTER TABLE "doc_changes" ALTER COLUMN "tenant" DROP DEFAULT;
			ALTER TABLE "doc_changes" DROP CONSTRAINT IF EXISTS doc_changes_pkey;
			ALTER TABLE "doc_changes" ADD PRIMARY KEY ("tenant", "id", "change_id");
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'column `tenant` already exists.';
		END;
	END;
$$
