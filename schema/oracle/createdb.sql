
-- Oracle uses users as namespaces for tables creation.
-- In "onlyoffice.table_name", "onlyoffice" is a user name, and table_name exists only within this namespace.

-- ----------------------------
-- Table structure for doc_changes
-- ----------------------------
CREATE TABLE doc_changes (
    tenant NVARCHAR2(255) NOT NULL,
    id NVARCHAR2(255) NOT NULL,
    change_id NUMBER NOT NULL,
    user_id NVARCHAR2(255) NOT NULL,
    user_id_original NVARCHAR2(255) NOT NULL,
    user_name NVARCHAR2(255) NOT NULL,
    change_data NCLOB NOT NULL,
    change_date TIMESTAMP NOT NULL,
    CONSTRAINT doc_changes_unique UNIQUE (tenant, id, change_id),
    CONSTRAINT doc_changes_unsigned_int CHECK (change_id BETWEEN 0 AND 4294967295)
);

-- ----------------------------
-- Table structure for task_result
-- ----------------------------
CREATE TABLE task_result (
    tenant NVARCHAR2(255) NOT NULL,
    id NVARCHAR2(255) NOT NULL,
    status NUMBER NOT NULL,
    status_info NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT SYSDATE NOT NULL,
    last_open_date TIMESTAMP NOT NULL,
    user_index NUMBER DEFAULT 1 NOT NULL,
    change_id NUMBER DEFAULT 0 NOT NULL,
    callback NCLOB,  -- Note: codebase uses '' as default value, but Oracle treats '' as NULL
    baseurl NCLOB,   -- Note: codebase uses '' as default value, but Oracle treats '' as NULL
    password NCLOB NULL,
    additional NCLOB NULL,
    CONSTRAINT task_result_unique UNIQUE (tenant, id),
    CONSTRAINT task_result_unsigned_int CHECK (user_index BETWEEN 0 AND 4294967295 AND change_id BETWEEN 0 AND 4294967295)
);
