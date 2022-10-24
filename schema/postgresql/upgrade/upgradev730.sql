DO $$ 
	BEGIN
		BEGIN
			ALTER TABLE doc_changes ALTER COLUMN change_data TYPE bytea USING change_data::bytea;
		EXCEPTION
			WHEN duplicate_column THEN RAISE NOTICE 'cant modify doc_changes.change_data colummn';
		END;
	END;
$$
