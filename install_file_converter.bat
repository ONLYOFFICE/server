ECHO OFF

ECHO.

ECHO ----------------------------------------
ECHO svn update
ECHO ----------------------------------------

TortoiseProc.exe /command:update /path:"%~dp0" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\OfficeWeb" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\SDK\lib\win_32" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\SDK\lib\DoctRenderer.config" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\SDK\bin\windows" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\SDK\bin\AllFontsGen" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\UnicodeConverter\icubuilds\win32\bin" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\ServerComponents\DesktopEditor\ChromiumBasedEditors\app\cefbuilds\win32" /closeonend:1
TortoiseProc.exe /command:update /path:"%~dp0\..\AsyncServerComponents\Bin\Windows" /closeonend:1

ECHO ----------------------------------------
ECHO copy file to converter
ECHO ----------------------------------------

mkdir "%~dp0\App_Data"
mkdir "%~dp0\FileConverter\Bin"
mkdir "%~dp0\FileConverter\Bin\HtmlFileInternal"

cd /D "%~dp0\FileConverter\Bin" || goto ERROR
copy "..\..\..\ServerComponents\SDK\bin\windows\icudt.dll" "."
copy "..\..\..\ServerComponents\UnicodeConverter\icubuilds\win32\bin\icudt55.dll" "."
copy "..\..\..\ServerComponents\UnicodeConverter\icubuilds\win32\bin\icuuc55.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\DoctRenderer.config" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\doctrenderer.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\HtmlRenderer.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\DjVuFile.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\XpsFile.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\PdfReader.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\PdfWriter.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\HtmlFile.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\UnicodeConverter.dll" "."
copy "..\..\..\ServerComponents\SDK\lib\win_32\HtmlFileInternal.exe" ".\HtmlFileInternal"
xcopy /s/h/e/k/c/y/q "..\..\..\ServerComponents\DesktopEditor\ChromiumBasedEditors\app\cefbuilds\win32" ".\HtmlFileInternal"
copy "..\..\..\AsyncServerComponents\Bin\Windows\x2t32.exe" "."

powershell -Command "(gc ./DoctRenderer.config) -replace '../../OfficeWeb', '../../../OfficeWeb' | sc ./DoctRenderer.config"
"..\..\..\ServerComponents\SDK\bin\AllFontsGen\windows_32.exe" "%~dp0\..\OfficeWeb\Fonts\native" "" "" "%~dp0\FileConverter\Bin\font_selection.bin"

:ERROR
:SUCCESS

exit /b 0
