Настройка сервиса документов

1. Установка необходимых компонентов

Для работы сервиса документов необходимо установить в системе следующие компоненты:
	а) 32-х разрядную версии Node.js 0.12.x (https://nodejs.org/dist/v0.12.7/node-v0.12.7-x86.msi)
	б) MySql Server 5.6 (https://dev.mysql.com/downloads/mysql/) При установке для пользователя root используйте пароль onlyoffice
	в) Erlang (http://www.erlang.org/download.html)
	г) RabbitMQ (https://www.rabbitmq.com/releases/rabbitmq-server/v3.5.4/rabbitmq-server-3.5.4.exe)
	д) Redis (https://github.com/MSOpenTech/redis/releases/download/win-2.8.2102/Redis-x64-2.8.2102.msi)
	е) Python 2.7.3 ()http://www.python.org/download/releases/2.7.3/#download)

2. Настройка системы

	а) Настройка БД
	
	б) Установка npm модулей.
	Запустите скрипт install_npm_modules.bat
	
	в) Установка Web Monitor для RabbitMQ подробности(https://www.rabbitmq.com/management.html)
	открытивает cmd. переходим в папку (cd /d Installation-directory/sbin)
	вызываем(rabbitmq-plugins.bat enable rabbitmq_management)
	Web Monitor распологается по адресу(http://localhost:15672/). логин/пароль(guest/guest)

3. Запуск сервиса

Запустите скриптом run_services.bat