@ECHO OFF

SET MONGO_DB_SERVICE_NAME=ASC Mongo DB Server
SET CO_AUTHORING_SERVICE_NAME=ASC CoAuthoring Server
SET SPELLCHECK_SERVICE_NAME=ASC Spellcheck Server
SET INSTAL_SCRIPT_FOLDER=install_script
SET DB_FILE_PATH=data\db

IF NOT EXIST %~dp0%DB_FILE_PATH% MKDIR %~dp0%DB_FILE_PATH%
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%MONGO_DB_SERVICE_NAME%" "%~dp0mongodb\bin\mongod.exe --journal --dbpath "%~dp0%DB_FILE_PATH%"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\ConfigMongoDB.bat
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallNodeJSModules.bat
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%CO_AUTHORING_SERVICE_NAME%" "node.exe %~dp0sources\server.js"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call %~dp0\%INSTAL_SCRIPT_FOLDER%\InstallAndRunService.bat "%SPELLCHECK_SERVICE_NAME%" "node.exe %~dp0sources\serverSpellCheck.js"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR


:ERROR
:SUCCESS
pause

exit /b 0