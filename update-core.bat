ECHO OFF

reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS=32&&set OS2=x86||set OS=64&& set OS2=x64
for /f "tokens=2" %%I in ('git.exe branch 2^> NUL ^| findstr /b "* "') do set GITBRANCH=%%I

ECHO.
ECHO ----------------------------------------
ECHO download core
ECHO ----------------------------------------


mkdir "%~dp0\FileConverter\bin"
mkdir "%~dp0\FileConverter\bin\HtmlFileInternal"

powershell -executionpolicy remotesigned -file update-core.ps1 "http://repo-doc-onlyoffice-com.s3.amazonaws.com/windows/core/origin/%GITBRANCH%/latest/%OS2%/core.zip" "%~dp0FileConverter\bin\core.zip" "%~dp0FileConverter\bin\core"

cd /D "%~dp0\FileConverter\bin" || goto ERROR
copy "core\Common\3dParty\v8\win_%OS%\release\icudt.dll" "."
copy "core\Common\3dParty\icu\win_%OS%\build\icudt55.dll" "."
copy "core\Common\3dParty\icu\win_%OS%\build\icuuc55.dll" "."
copy "core\build\lib\win_%OS%\doctrenderer.dll" "."
copy "core\build\lib\win_%OS%\HtmlRenderer.dll" "."
copy "core\build\lib\win_%OS%\DjVuFile.dll" "."
copy "core\build\lib\win_%OS%\XpsFile.dll" "."
copy "core\build\lib\win_%OS%\PdfReader.dll" "."
copy "core\build\lib\win_%OS%\PdfWriter.dll" "."
copy "core\build\lib\win_%OS%\HtmlFile.dll" "."
copy "core\build\lib\win_%OS%\UnicodeConverter.dll" "."
copy "core\build\lib\win_%OS%\HtmlFileInternal.exe" ".\HtmlFileInternal"
xcopy /s/h/e/k/c/y/q "core\Common\3dParty\cef\win_%OS%\build" ".\HtmlFileInternal"
copy "core\build\bin\win_%OS%\x2t.exe" "."

"core\build\bin\AllFontsGen\win_%OS%.exe" "%windir%\Fonts" "%~dp0\..\sdkjs\common\AllFonts.js" "%~dp0\..\sdkjs\common\Images" "%~dp0\FileConverter\bin\font_selection.bin"

:ERROR
