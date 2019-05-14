ECHO OFF

ECHO.
ECHO ----------------------------------------
ECHO restart RabbitMQ node to prevent "Erl.exe high CPU usage every Monday morning on Windows" https://groups.google.com/forum/#!topic/rabbitmq-users/myl74gsYyYg
ECHO ----------------------------------------

call restart-rabbit.bat

ECHO.
ECHO ----------------------------------------
ECHO copy file to converter
ECHO ----------------------------------------

call update-core.bat

mkdir "%~dp0\App_Data"

mkdir "%~dp0\SpellChecker\dictionaries"
cd /D "%~dp0\SpellChecker" || goto ERROR
xcopy /s/e/k/c/y/q "..\..\dictionaries" ".\dictionaries"

ECHO.
ECHO ----------------------------------------
ECHO Start build skd-all.js
ECHO ----------------------------------------
CD /D %~dp0\..\sdkjs\build
call npm install -g grunt-cli
call npm install
call grunt --src="./configs" --level=WHITESPACE_ONLY --formatting=PRETTY_PRINT


ECHO.
ECHO ----------------------------------------
ECHO Install node.js modules 
ECHO ----------------------------------------

CD /D %~dp0\DocService || goto ERROR
call npm install

cd /D ..\Common || goto ERROR
call npm install

cd /D ..\FileConverter || goto ERROR
call npm install

cd /D ..\SpellChecker || goto ERROR
call npm install

SET RUN_DIR=%~dp0
SET NODE_ENV=development-windows
SET NODE_CONFIG_DIR=%RUN_DIR%\Common\config

cd "%RUN_DIR%\DocService\sources"
start /min /b node server.js
start /min /b node gc.js

cd "%RUN_DIR%\FileConverter\sources"
start /min /b node convertermaster.js

cd "%RUN_DIR%\SpellChecker\sources"
start /min /b node server.js

:ERROR
:SUCCESS
pause
