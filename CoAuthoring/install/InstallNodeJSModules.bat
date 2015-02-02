ECHO OFF

SET RUN_FOLDER=%CD%

CD /D %~dp0..\ || exit /b 1

ECHO.
ECHO ----------------------------------------
ECHO Install node.js modules 
ECHO ----------------------------------------

call npm install express --production || exit /b 1
call npm install underscore --production || exit /b 1
call npm install sockjs --production|| exit /b 1
call npm install mongodb@1.1.4 --production || exit /b 1
call npm install mysql || exit /b 1
call npm install pg || exit /b 1

cd /D ..\Common || exit /b 1
call npm install log4js@0.6.2 --production || exit /b 1

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
