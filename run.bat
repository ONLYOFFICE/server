ECHO OFF

ECHO.
ECHO ----------------------------------------
ECHO check Node.js version
ECHO ----------------------------------------

FOR /F "tokens=*" %%a IN ('node -v') DO (SET NODEJS_V=%%a)
ECHO Installed Node.js version %NODEJS_V%
FOR /F "tokens=1 delims=." %%a IN ("%NODEJS_V%") DO (SET NODEJS_V=%%a)
SET NODEJS_V=%NODEJS_V:~1,2%
SET NODEJS_V_MIN=8

if %NODEJS_V_MIN% GTR %NODEJS_V% (
	ECHO ERROR Node.js version! %NODEJS_V_MIN% more than %NODEJS_V%. Min version Node.js 8.x
	goto ERROR
)

ECHO.
ECHO ----------------------------------------
ECHO restart RabbitMQ node to prevent "Erl.exe high CPU usage every Monday morning on Windows" https://groups.google.com/forum/#!topic/rabbitmq-users/myl74gsYyYg
ECHO ----------------------------------------

call restart-rabbit.bat

ECHO.
ECHO ----------------------------------------
ECHO Build modules
ECHO ----------------------------------------
cd /D "%~dp0\..\build_tools"
call python configure.py --branch develop --module develop --update 1 --update-light 1 --clean 0 --sdkjs-addon comparison
call python make.py

mkdir "%~dp0\App_Data"

mkdir "%~dp0\SpellChecker\dictionaries"
cd /D "%~dp0\SpellChecker" || goto ERROR
xcopy /s/e/k/c/y/q "..\..\dictionaries" ".\dictionaries"


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

cd "%RUN_DIR%\FileConverter\sources"
start /min /b node convertermaster.js

cd "%RUN_DIR%\SpellChecker\sources"
start /min /b node server.js

:ERROR
:SUCCESS
pause
