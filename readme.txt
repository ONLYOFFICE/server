Настройка сервиса документов

1. Установка необходимых компонентов

Для работы сервиса документов необходимо установить в системе следующие компоненты:
	а) 32-х разрядную версии Node.js 0.12.x (https://nodejs.org/dist/v0.12.7/node-v0.12.7-x86.msi)
	б) MySql Server 5.6 (https://dev.mysql.com/downloads/mysql/) При установке для пользователя root используйте пароль onlyoffice
	в) RabbitMQ (https://www.rabbitmq.com/releases/rabbitmq-server/v3.5.4/rabbitmq-server-3.5.4.exe)
	г) Redis (https://github.com/MSOpenTech/redis/releases/download/win-2.8.2102/Redis-x64-2.8.2102.msi)
	д) Python 2.7.3 ()http://www.python.org/download/releases/2.7.3/#download)

2. Настройка системы

	а) Настройка БД
	
	б) Установка npm модулей.
	Запустите скрипт install_npm_modules.bat

3. Запуск сервиса

Запустите скриптом run_services.bat