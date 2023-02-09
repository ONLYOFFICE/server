-- MySQL Administrator dump 1.4
--
-- ------------------------------------------------------
-- Server version	5.5.15


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;

/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;


--
-- Create schema onlyoffice
--

CREATE DATABASE IF NOT EXISTS onlyoffice DEFAULT CHARACTER SET utf8 DEFAULT COLLATE utf8_general_ci;
USE onlyoffice;

--
-- Definition of table `doc_changes`
--

CREATE TABLE IF NOT EXISTS `doc_changes` (
  `tenant` varchar(255) NOT NULL,
  `id` varchar(255) NOT NULL,
  `change_id` int(10) unsigned NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `user_id_original` varchar(255) NOT NULL,
  `user_name` varchar(255) NOT NULL,
  `change_data` longtext NOT NULL,
  `change_date` datetime NOT NULL,
  PRIMARY KEY (`tenant`, `id`,`change_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `doc_changes`
--

/*!40000 ALTER TABLE `doc_changes` DISABLE KEYS */;
/*!40000 ALTER TABLE `doc_changes` ENABLE KEYS */;


--
-- Definition of table `task_result`
--

CREATE TABLE IF NOT EXISTS `task_result` (
  `tenant` varchar(255) NOT NULL,
  `id` varchar(255) NOT NULL,
  `status` tinyint(3) NOT NULL,
  `status_info` int(10) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_open_date` datetime NOT NULL,
  `user_index` int(10) unsigned NOT NULL DEFAULT 1,
  `change_id` int(10) unsigned NOT NULL DEFAULT 0,
  `callback` longtext NOT NULL,
  `baseurl` text NOT NULL,
  `password` longtext NULL,
  `additional` longtext NULL,
  PRIMARY KEY (`tenant`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `task_result`
--

/*!40000 ALTER TABLE `task_result` DISABLE KEYS */;
/*!40000 ALTER TABLE `task_result` ENABLE KEYS */;


/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
