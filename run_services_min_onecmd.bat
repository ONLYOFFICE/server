SET RUN_DIR=%CD%

SET NODE_ENV=development-windows
SET NODE_CONFIG_DIR=%RUN_DIR%\Common\config

cd %RUN_DIR%\CoAuthoring\sources
start /min /b node --harmony server.js

cd %RUN_DIR%\FileConverter\sources
start /min /b node --harmony convertermaster.js

cd %RUN_DIR%\FileStorage\sources
start /min /b node server.js

cd %RUN_DIR%\SpellChecker\sources
start /min /b node server.js

pause