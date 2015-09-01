SET NODE_ENV=development-windows

SET RUN_DIR=%CD%

cd %RUN_DIR%\CoAuthoring\sources
start node --harmony server.js

cd %RUN_DIR%\FileConverter\sources
start node --harmony convertermaster.js

cd %RUN_DIR%\FileStorage\sources
start node server.js

cd %RUN_DIR%\SpellChecker\sources
start node server.js

pause