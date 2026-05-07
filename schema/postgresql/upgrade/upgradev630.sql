DO $$ 
	BEGIN
		BEGIN
			ALTER TABLE "task_result" ADD COLUMN "created_at" timestamp without time zone DEFAULT NOW();
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'column created_at already exists.';
		END;

		BEGIN
			ALTER TABLE "task_result" ADD COLUMN "password" text;
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'column password already exists.';
		END;
	END;
$$