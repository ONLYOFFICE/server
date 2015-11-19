SET RUN_DIR=%CD%

call "%RUN_DIR%\install_file_converter.bat"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

call "%RUN_DIR%\install_npm_modules.bat"
@IF NOT "%ERRORLEVEL%"=="0" goto ERROR

SET NODE_ENV=development-windows
SET NODE_CONFIG_DIR=%RUN_DIR%\Common\config

cd "%RUN_DIR%\DocService\sources"
start /min /b node server.js

cd "%RUN_DIR%\FileConverter\sources"
start /min /b node convertermaster.js

cd "%RUN_DIR%\FileStorage\sources"
start /min /b node server.js

cd "%RUN_DIR%\SpellChecker\sources"
start /min /b node server.js

:ERROR
:SUCCESS
pause