DELIMITER DLM00

DROP PROCEDURE IF EXISTS upgrade720 DLM00

CREATE PROCEDURE upgrade720()
BEGIN
	
	IF NOT EXISTS(SELECT * FROM information_schema.`COLUMNS` WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_result' AND COLUMN_NAME = 'tenant') THEN
		SET SQL_SAFE_UPDATES=0;
		ALTER TABLE `task_result` ADD COLUMN `tenant` VARCHAR(255) NULL FIRST;
		UPDATE `task_result` SET `tenant`='localhost' WHERE `tenant` IS NULL;
		ALTER TABLE `task_result` CHANGE COLUMN `tenant` `tenant` VARCHAR(255) NOT NULL;
		ALTER TABLE `task_result` DROP PRIMARY KEY;
		ALTER TABLE `task_result` ADD PRIMARY KEY (`tenant`, `id`);
		SET SQL_SAFE_UPDATES=1;
	END IF;
	
	IF NOT EXISTS(SELECT * FROM information_schema.`COLUMNS` WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doc_changes' AND COLUMN_NAME = 'tenant') THEN
		SET SQL_SAFE_UPDATES=0;
		ALTER TABLE `doc_changes` ADD COLUMN `tenant` VARCHAR(255) NULL FIRST;
		UPDATE `doc_changes` SET `tenant`='localhost' WHERE `tenant` IS NULL;
		ALTER TABLE `doc_changes` CHANGE COLUMN `tenant` `tenant` VARCHAR(255) NOT NULL;
		ALTER TABLE `doc_changes` DROP PRIMARY KEY;
		ALTER TABLE `doc_changes` ADD PRIMARY KEY (`tenant`, `id`,`change_id`);
		SET SQL_SAFE_UPDATES=1;
	END IF;

END DLM00

CALL upgrade720() DLM00

DELIMITER ;
