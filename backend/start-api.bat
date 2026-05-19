@echo off
set "VENV_DIR=C:\Users\%USERNAME%\AppData\Local\bringe\backend-venv"
call "%VENV_DIR%\Scripts\activate.bat"
cd /d "%~dp0"
echo Starting Bringe API on http://localhost:8000 ...
uvicorn main:app --reload --port 8000
pause
