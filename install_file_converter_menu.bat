ECHO OFF

ECHO.
ECHO ----------------------------------------
ECHO copy file to converter
ECHO ----------------------------------------

"..\AllFontsGen\windows_32.exe" "%windir%\Fonts" "%~dp0\..\..\Projects\wwwrootOffice\sdk\Common\AllFonts.js" "%~dp0\..\..\Projects\wwwrootOffice\sdk\Common\Images" "%~dp0\FileConverter\Bin\font_selection.bin"

:ERROR
:SUCCESS

exit /b 0
