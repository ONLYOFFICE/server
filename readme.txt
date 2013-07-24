1.	Установить nodeJS с официального сайта nodejs.org
2.	Скачать mongoDB с официального сайта mongodb.org в папку mongodb в текущий каталог

Далее возможна работа компонентов коавторинга в двух режимах: как сервисы, и как обычные приложения.

Установка коавторинга как сервис:
а.	Скачать с официального сайта microsoft и установить Windows Server 2003 Resource Kit Tools
б.	Запустить InstallAndRunCoAuthoring.bat с правами администратора. 
Этот скрипт делает следующее:
 - устанавливает и запускает как службу, базу данных (mongodb).
 - конфигурирует базу данных, создаёт таблицы в базе coAuthoring и индексирует их, выполнив следующие команды.
	- db.createCollection("messages").
	- db.messages.ensureIndex({"docid":1}).
	- db.createCollection("changes").
	- db.changes.ensureIndex({"docid":1}).
 - устанавливает и запускает как службу node.js.

 Запуск компонентов коавторинга как приложения:
 а. При первом запуске: 
	- сконфигурировать бд, запустив install_script\ConfigMongoDB.bat
	- поставить необходимые компоненты для node.js, запустив install_script\InstallNodeJSModules.bat
 б. Запустить процесс базы данных (mongodb), выполнив install_script\StartMongoDb.bat
 в. Запустить node.js выполив install_script\StartServer.bat
 
 Установка проверки орфографии:
  - Скачать Python версию 2.7.3 http://www.python.org/download/releases/2.7.3/#download
  - Запустить InstallNodeJSSpellCheck.bat