ECHO OFF

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

cd /D ..\FileStorage || goto ERROR
call npm install

cd /D ..\SpellChecker || goto ERROR
call npm install

:ERROR
:SUCCESS

exit /b 0
