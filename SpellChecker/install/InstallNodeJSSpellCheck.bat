ECHO OFF

SET RUN_FOLDER=%CD%

ECHO.
ECHO ----------------------------------------
ECHO Install node.js module spellCheck (nodehun) 
ECHO ----------------------------------------

CD /D %~dp0..\ || exit /b 1
call npm install

cd /D ..\Common || exit /b 1
call npm install

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
