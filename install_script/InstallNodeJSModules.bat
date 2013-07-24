ECHO OFF

SET RUN_FOLDER=%CD%

CD /D %~dp0..\ || exit /b 1

ECHO.
ECHO ----------------------------------------
ECHO Install node.js modules 
ECHO ----------------------------------------

call npm install express@2.5.8 || exit /b 1
call npm install underscore || exit /b 1
call npm install sockjs || exit /b 1
call npm install mongodb@1.1.4 || exit /b 1
call npm install log4js || exit /b 1

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
