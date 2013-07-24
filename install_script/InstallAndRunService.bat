ECHO OFF
SET RUN_FOLDER=%CD%
SET SERVICE_NAME=%1
SET SERVICE_NAME=%SERVICE_NAME:"=%
SET EXE_PATH=%2
SET EXE_PATH=%EXE_PATH:"=%

rem ECHO.
rem ECHO ----------------------------------------
rem ECHO Check is the script run under administrator %RUN_FOLDER%
rem ECHO ----------------------------------------

rem if not "%RUN_FOLDER%"=="%WinDir%\system32" GOTO ERROR

SET INSTSRV=instsrv.exe
SET WINDOWS_RESOURCE_KIT_SUBPATH=Windows Resource Kits\Tools
SET WINDOWS_RESOURCE_KIT_PATH=%ProgramFiles(x86)%\%WINDOWS_RESOURCE_KIT_SUBPATH%

SET TMP_REG_FILE=tmp.reg

if not exist "%WINDOWS_RESOURCE_KIT_PATH%\%INSTSRV%" SET WINDOWS_RESOURCE_KIT_PATH=%ProgramFiles%\%WINDOWS_RESOURCE_KIT_SUBPATH%

if not exist "%WINDOWS_RESOURCE_KIT_PATH%\%INSTSRV%" goto ERROR

CD /D "%WINDOWS_RESOURCE_KIT_PATH%" || goto ERROR

ECHO.
ECHO ----------------------------------------
ECHO Install %EXE_PATH% as "%SERVICE_NAME%" service 
ECHO ----------------------------------------

"%WINDOWS_RESOURCE_KIT_PATH%\%INSTSRV%" "%SERVICE_NAME%" "%WINDOWS_RESOURCE_KIT_PATH%\srvany.exe" || goto ERROR

ECHO Windows Registry Editor Version 5.00 > %TMP_REG_FILE%
ECHO [HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\services\%SERVICE_NAME%\Parameters] >> %TMP_REG_FILE%
ECHO "Application"="%EXE_PATH:\=\\%" >> %TMP_REG_FILE%

regedit.exe /s %TMP_REG_FILE% || goto ERROR

ECHO.
ECHO ----------------------------------------
ECHO Start "%SERVICE_NAME%" service 
ECHO ----------------------------------------
call sc start "%SERVICE_NAME%" || goto ERROR

DEL %TMP_REG_FILE%
CD /D %RUN_FOLDER%

:SUCCESS
exit /b 0

:ERROR
exit /b 1
