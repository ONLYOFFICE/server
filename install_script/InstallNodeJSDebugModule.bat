ECHO OFF

SET RUN_FOLDER=%CD%

CD /D %~dp0..\ || exit /b 1

ECHO.
ECHO ----------------------------------------
ECHO Install node.js module debug 
ECHO ----------------------------------------

call npm install node-inspector || exit /b 1

CD /D %RUN_FOLDER% || exit /b 1

exit /b 0
