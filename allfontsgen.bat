ECHO OFF

reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS=32&&set OS2=x86||set OS=64&& set OS2=x64

cd /D "%~dp0\..\core\build\lib\win_%OS%"
"%~dp0\..\core\build\bin\AllFontsGen\win_%OS%.exe" "%windir%\Fonts" "%~dp0\..\sdkjs\common\AllFonts.js" "%~dp0\..\sdkjs\common\Images" "%~dp0\FileConverter\bin\font_selection.bin"

:ERROR
