Настройка сервиса документов

ВНИМАНИЕ, инструкция описывает разворачивание сервиса документов на Windows-платформе.

0. Остановить сайт IIS сайт на 8001 порту(тестовый пример не надо оставливать)

1. Установка необходимых компонентов

Для работы сервиса документов необходимо установить в системе следующие компоненты (если не указано дополнительно, нужно ставить последнюю стабильную версию, любой разрядности, с дефолтными настройками):
	а) 32-х разрядную версии Node.js 4.0.x (https://nodejs.org/dist/v4.0.0/node-v4.0.0-x86.msi) 
		Для уточнения существующей версии Node.js выполните 'node -v' 
		32-х разрядная версия требуется только для модуля проверки орфографии, если не планируется использовать этот модуль можно использовать 64-х разрядную версию.
	б) MySql Server 5.6 и выше (http://dev.mysql.com/downloads/windows/installer/) При установке для пользователя root используйте пароль onlyoffice
	в) Erlang (http://www.erlang.org/download.html)
	г) RabbitMQ (https://www.rabbitmq.com/releases/rabbitmq-server/v3.5.4/rabbitmq-server-3.5.4.exe)
	д) Redis (https://github.com/MSOpenTech/redis/releases/download/win-2.8.2102/Redis-x64-2.8.2102.msi)
	е) Python 2.7.x (http://www.python.org/download/releases/2.7.3/#download)
	ё) Microsoft Visual C++ Express 2010 (?) (требуется для сборки модулей для Spellchecker)

2. Настройка системы

	а) Настройка БД
	Выполните скрипт в mysql document-server/schema/createdb.sql
	
	б) Установка npm модулей.
	Запустите скрипт install_npm_modules.bat
	
	в) Установка Web Monitor для RabbitMQ подробности(https://www.rabbitmq.com/management.html)
	открытивает cmd. переходим в папку (cd /d Installation-directory/sbin)
	вызываем(rabbitmq-plugins.bat enable rabbitmq_management)
	Web Monitor распологается по адресу(http://localhost:15672/). логин/пароль(guest/guest)

	г) Если по какой-то причине у вас не стартует Redis, либо он стартует и через какое-то время падает, попробуйте в настройках конфига выставить размер параметра maxheap. Для WIN7 x64 файл конфига лежит тут: C:\Program Files\Redis\redis.windows-service.conf. В файле ищем строку
	# maxheap <bytes>
	и меняет ее, например, на  
	maxheap 128MB. 
	Перезапускаем сервис.
	
	д) Создать папку App_Data в папке nodeJSProjects.

	е) Если папка с меню называется не office или лежит не на одном уровне с OfficeWeb. то нужно создать локальный файл конфига nodeJSProjects\Common\config\local.json(под svn заливать не нужно)
	с содержимым(в элементах static_content.path указать путь к меню)
{
  "services": {
    "CoAuthoring": {
      "server": {
        "static_content": [
          {
            "name": "/OfficeWeb",
            "path": "../../../OfficeWeb"
          },
          {
            "name": "/office",
            "path": "../../../office"
          }
        ]
      }
    }
  }
}

3. Запуск сервиса

Запустите скрипт run_services.bat

Замечания

	а) Все конфиги для серверной части храняться в папке nodeJSProjects\Common\config
		 - default.json  общие конфиги одинаковые для всех версий продакшина.
		 - production-windows.json конфиги для запуска продакшин-версии на windows платформе
		 - production-linux.json конфиги для запуска продакшин-версии на linux платформе
		 - development-windows.json конфиги для запуска девелоперской-версии на windows платформе (Эта конфигурация используется при запуске run_services.bat)

	При необходимости внести временные изменения в конфиги создайте файл local.json и переопределите значения там. Файл коммитить под svn не надо. Это позволит случайно не залить локальные правки и избежать потери конфига при обновлении svn. Пример использования описан в пункте 2-д. Подробно о файлах конфигурации см. https://github.com/lorenwest/node-config/wiki/Configuration-Files

4. Лицензия.
	Чтобы заработали комментарии, чат и другие платные возможности необходимо указать файл с лицензией (если путь не указан, то файл лицензии пытается открыться из корневой папки с именем 'licence.lic'):
{
  "license": {
      "license_file": "./../../license.lic"
    }
}
Актуальная версия лицензии по запросу.
