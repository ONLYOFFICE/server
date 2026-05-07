--
-- Create schema onlyoffice
--

-- CREATE DATABASE onlyoffice ENCODING = 'UTF8' CONNECTION LIMIT = -1;

-- ----------------------------
-- Table structure for doc_changes
-- ----------------------------
CREATE TABLE doc_changes
(
tenant varchar(255) NOT NULL,
id varchar(255) NOT NULL,
change_id int NOT NULL,
user_id varchar(255) NOT NULL,
user_id_original varchar(255) NOT NULL,
user_name varchar(255) NOT NULL,
change_data text NOT NULL,
change_date TIMESTAMP(6) NOT NULL,
PRIMARY KEY (tenant, id, change_id)
);

-- ----------------------------
-- Table structure for task_result
-- ----------------------------
CREATE TABLE task_result
(
tenant varchar(255) NOT NULL,
id varchar(255) NOT NULL,
status int NOT NULL,
status_info int NOT NULL,
created_at TIMESTAMP(6) DEFAULT NOW(),
last_open_date TIMESTAMP(6) NOT NULL,
user_index int NOT NULL DEFAULT 1,
change_id int NOT NULL DEFAULT 0,
callback text NOT NULL,
baseurl text NOT NULL,
password text NULL,
additional text NULL,
PRIMARY KEY (tenant, id)
);
