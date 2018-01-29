--
-- Definition of table `doc_changes`
--

CREATE TABLE DOC_CHANGES (
  id varchar2(255) NOT NULL,
  change_id number NOT NULL,
  user_id varchar2(255) NOT NULL,
  user_id_original varchar2(255) NOT NULL,
  user_name varchar2(255) NOT NULL,
  change_data CLOB NOT NULL,
  change_date TIMESTAMP NOT NULL
);

ALTER TABLE DOC_CHANGES ADD CONSTRAINT XPKDOC_CHANGES PRIMARY KEY (id, change_id);

--
-- Definition of table `task_result`
--

CREATE TABLE TASK_RESULT (
  id varchar2(255) NOT NULL,
  status number(3) NOT NULL,
  status_info number NOT NULL,
  last_open_date TIMESTAMP NOT NULL,
  user_index number DEFAULT 1 NOT NULL,
  change_id number DEFAULT 0 NOT NULL,
  callback varchar2(2000) NULL,
  baseurl varchar2(2000) NULL,
  CONSTRAINT XPKTASK_RESULT PRIMARY KEY (id)
);