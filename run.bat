ECHO OFF

ECHO.
ECHO ----------------------------------------
ECHO copy file to converter
ECHO ----------------------------------------

mkdir "%~dp0\App_Data"
mkdir "%~dp0\FileConverter\Bin"
mkdir "%~dp0\FileConverter\Bin\HtmlFileInternal"

cd /D "%~dp0\FileConverter\Bin" || goto ERROR
copy "..\..\..\core\build\bin\windows\icudt.dll" "."
copy "..\..\..\core\build\bin\icu\win_32\icudt55.dll" "."
copy "..\..\..\core\build\bin\icu\win_32\icuuc55.dll" "."
copy "..\..\..\core\build\lib\DoctRenderer.config" "."
copy "..\..\..\core\build\lib\win_32\doctrenderer.dll" "."
copy "..\..\..\core\build\lib\win_32\HtmlRenderer.dll" "."
copy "..\..\..\core\build\lib\win_32\DjVuFile.dll" "."
copy "..\..\..\core\build\lib\win_32\XpsFile.dll" "."
copy "..\..\..\core\build\lib\win_32\PdfReader.dll" "."
copy "..\..\..\core\build\lib\win_32\PdfWriter.dll" "."
copy "..\..\..\core\build\lib\win_32\HtmlFile.dll" "."
copy "..\..\..\core\build\lib\win_32\UnicodeConverter.dll" "."
copy "..\..\..\core\build\lib\win_32\HtmlFileInternal.exe" ".\HtmlFileInternal"
xcopy /s/h/e/k/c/y/q "..\..\..\core\build\cef\win32" ".\HtmlFileInternal"
copy "..\..\..\core\build\bin\windows\x2t32.exe" "."

powershell -Command "(gc ./DoctRenderer.config) -replace '../../OfficeWeb', '../../../sdkjs' | sc ./DoctRenderer.config"
"..\..\..\core\build\bin\AllFontsGen\windows_32.exe" "%windir%\Fonts" "%~dp0\..\sdkjs\сommon\AllFonts.js" "%~dp0\..\sdkjs\Common\Images" "%~dp0\FileConverter\Bin\font_selection.bin"

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

cd /D ..\SpellChecker || goto ERROR
call npm install

SET RUN_DIR=%~dp0
SET NODE_ENV=development-windows
SET NODE_CONFIG_DIR=%RUN_DIR%\Common\config

cd "%RUN_DIR%\DocService\sources"
start /min /b node server.js
start /min /b node gc.js

cd "%RUN_DIR%\FileConverter\sources"
start /min /b node convertermaster.js

:ERROR
:SUCCESS
pause