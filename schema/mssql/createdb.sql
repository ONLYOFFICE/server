-- Modified for SQL Server
-- Requires SQL Server 2016 (13.x) or newer
-- Features used:
--   - DROP TABLE IF EXISTS (SQL Server 2016+)
--   - Data compression (SQL Server 2008 R2+)

-- CREATE DATABASE onlyoffice;
-- GO

-- USE onlyoffice;
-- GO

-- SQL Server Configuration Parameters
-- ANSI_NULLS ON: Enables ISO standard NULL handling behavior
--   When ON, comparison of NULL values evaluates to UNKNOWN instead of TRUE or FALSE
-- QUOTED_IDENTIFIER ON: Enables standard SQL string delimiter behavior
--   When ON, double quotes can be used to delimit identifiers and literal strings must use single quotes
-- ANSI_PADDING ON: Controls how column stores values shorter than the defined size
--   When ON, trailing blanks in char data and trailing zeros in binary data are preserved
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
GO

CREATE TABLE doc_changes(
    tenant NVARCHAR(255) NOT NULL,
    id NVARCHAR(255) NOT NULL,
    change_id int NOT NULL CHECK(change_id BETWEEN 0 AND 4294967295),
    user_id NVARCHAR(255) NOT NULL,
    user_id_original NVARCHAR(255) NOT NULL,
    user_name NVARCHAR(255) NOT NULL,
    change_data NVARCHAR(MAX) NOT NULL,
    change_date DATETIME NOT NULL,
    PRIMARY KEY NONCLUSTERED (tenant, id, change_id)
) WITH (DATA_COMPRESSION = PAGE);

CREATE TABLE task_result (
    tenant NVARCHAR(255) NOT NULL,
    id NVARCHAR(255) NOT NULL,
    status SMALLINT NOT NULL,
    status_info INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_open_date DATETIME NOT NULL,
    user_index int NOT NULL DEFAULT 1 CHECK(user_index BETWEEN 0 AND 4294967295),
    change_id int NOT NULL DEFAULT 0 CHECK(change_id BETWEEN 0 AND 4294967295),
    callback NVARCHAR(MAX) NOT NULL,
    baseurl NVARCHAR(MAX) NOT NULL,
    password NVARCHAR(MAX) NULL,
    additional NVARCHAR(MAX) NULL,
    PRIMARY KEY NONCLUSTERED (tenant, id)
) WITH (DATA_COMPRESSION = PAGE);
GO
