ECHO OFF

REM look up rabbitmqctl.bat in %ProgramFiles%
FOR /F "tokens=* USEBACKQ" %%F IN (`dir /S /B "%ProgramFiles%\RabbitMQ Server\*rabbitmqctl.bat"`) DO (
	SET RABBITMQCTL=%%F
)
REM look up rabbitmqctl.bat in %ProgramFiles(x86)%
if not exist "%RABBITMQCTL%" (
	FOR /F "tokens=* USEBACKQ" %%F IN (`dir /S /B "%ProgramFiles(x86)%\RabbitMQ Server\*rabbitmqctl.bat"`) DO (
		SET RABBITMQCTL=%%F
	)
)
if not exist "%RABBITMQCTL%" (
    echo.
    echo ******************************
    echo Missing rabbitmqctl.bat
    echo ******************************
    echo.
    exit /B 1
)
REM "net stop RabbitMQ && net start RabbitMQ" is more simple but requires admin rights
call "%RABBITMQCTL%" stop_app
call "%RABBITMQCTL%" start_app

:ERROR