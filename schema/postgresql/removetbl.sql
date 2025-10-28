SET client_min_messages = WARNING;
--
-- Drop tables
--
DROP TABLE IF EXISTS "doc_callbacks";
DROP TABLE IF EXISTS "doc_changes";
DROP TABLE IF EXISTS "task_result";

--https://www.postgresql.org/docs/current/static/plpgsql-control-structures.html#PLPGSQL-UPSERT-EXAMPLE
DROP FUNCTION IF EXISTS merge_db(_id varchar(255), _status int2, _status_info int8, _last_open_date timestamp without time zone, _title varchar(255), _user_index int8, _change_id int8, OUT isupdate char(5), OUT userindex int8) CASCADE;
DROP FUNCTION IF EXISTS merge_db(_id varchar(255), _status int2, _status_info int4, _last_open_date timestamp without time zone, _title varchar(255), _user_index int4, _change_id int4, OUT isupdate char(5), OUT userindex int4) CASCADE;
DROP FUNCTION IF EXISTS merge_db(_id varchar(255), _status int2, _status_info int4, _last_open_date timestamp without time zone, _user_index int4, _change_id int4, _callback text, _baseurl text, OUT isupdate char(5), OUT userindex int4) CASCADE;
