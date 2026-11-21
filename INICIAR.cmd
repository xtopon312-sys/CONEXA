@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto folder_error
py -3 -c "import sys; raise SystemExit(not sys.version_info >= (3, 10))" >nul 2>nul
if errorlevel 1 goto try_python
py -3 "%~dp0tools\windows_setup.py"
set "CONEXA_EXIT=%errorlevel%"
goto finish
:try_python
python -c "import sys; raise SystemExit(not sys.version_info >= (3, 10))" >nul 2>nul
if errorlevel 1 goto missing_python
python "%~dp0tools\windows_setup.py"
set "CONEXA_EXIT=%errorlevel%"
goto finish
:missing_python
echo Python 3.10 ou mais recente nao foi encontrado.
echo Instale Python pelo site https://www.python.org/downloads/windows/ e abra este arquivo novamente.
echo Se usar o instalador tradicional, habilite Python Launcher ou Add Python to PATH.
set "CONEXA_EXIT=1"
goto finish
:folder_error
echo Nao foi possivel abrir a pasta do projeto. Extraia o ZIP antes de continuar.
set "CONEXA_EXIT=1"
:finish
echo.
pause
exit /b %CONEXA_EXIT%
