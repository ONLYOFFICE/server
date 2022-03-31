DO $$ 
	BEGIN
		BEGIN
			ALTER TABLE "task_result" ADD COLUMN "additional" text;
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'column additional already exists.';
		END;
	END;
$$