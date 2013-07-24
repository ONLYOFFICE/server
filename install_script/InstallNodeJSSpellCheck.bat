ECHO OFF

SET RUN_FOLDER=%CD%

CD /D %~dp0..\ || exit /b 1

ECHO.
ECHO ----------------------------------------
ECHO Install node.js module spellCheck (nodehun) 
ECHO ----------------------------------------

call npm install express@2.5.8 || exit /b 1
call npm install sockjs || exit /b 1
call npm install log4js || exit /b 1

call npm install -g node-gyp || exit /b 1
call npm install nodehun@0.0.5 || exit /b 1

COPY nodehun\nodehun.cpp node_modules\nodehun\src\nodehun.cpp
COPY nodehun\replist.hxx node_modules\nodehun\src\hunspell\src\hunspell\replist.hxx

cd /D node_modules\nodehun\src || exit /b 1
call node-gyp configure || exit /b 1
call node-gyp build	|| exit /b 1

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
