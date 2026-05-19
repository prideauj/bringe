@echo off
setlocal

:: ============================================================
::  Bringe launcher (single-window)
::
::  Runs the FastAPI backend and the Vite dev server inside the
::  same console as this script. API logs and frontend logs are
::  interleaved with [API] / [FE] not prefixed -- both go to
::  stdout in order. Press Ctrl+C once to stop everything; the
::  window closes after a final taskkill on whatever's still
::  bound to port 8000.
::
::  Why one window now: previous version opened two cmd /k
::  windows that survived Ctrl+C and had to be closed manually.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

set "LOCAL_BASE=%LOCALAPPDATA%\bringe"
set "VENV_DIR=%LOCAL_BASE%\backend-venv"
set "FE_LAUNCH=%LOCAL_BASE%\frontend"
set "FE_REPO=%REPO%\frontend"
set "API_PORT=8000"

:: ---- Preflight ----
if not exist "%VENV_DIR%\Scripts\python.exe" goto :err_venv
if not exist "%FE_LAUNCH%\node_modules"       goto :err_nm
if not exist "%FE_LAUNCH%\src"                goto :err_src
if not exist "%REPO%\backend\main.py"         goto :err_backend

echo ============================================
echo  Bringe ^| Brighton Fringe 2026
echo  API : http://localhost:%API_PORT%
echo  App : http://localhost:5173
echo.
echo  Output below interleaves both services.
echo  Ctrl+C once stops both ^(answer Y when cmd
echo  asks "Terminate batch job?"^).
echo ============================================
echo.

:: Refresh config files from the repo so edits in source-of-truth
:: take effect without re-running setup.bat. (Same idea as before.)
call :copy_one package.json
call :copy_one vite.config.js
call :copy_one tailwind.config.js
call :copy_one postcss.config.js
call :copy_one index.html

:: Activate venv into this shell so uvicorn is on PATH.
call "%VENV_DIR%\Scripts\activate.bat"

:: Launch uvicorn in the background of the CURRENT console. Output
:: from --reload's parent + worker still appears here. `start "" /B`
:: requires a (possibly empty) title before /B or the parser treats
:: the first arg as the title.
pushd "%REPO%\backend"
start "" /B "%VENV_DIR%\Scripts\python.exe" -m uvicorn main:app --reload --port %API_PORT%
popd

:: Give uvicorn a moment to bind to the port before Vite proxies hit it.
timeout /t 2 /nobreak >nul

:: Frontend in the foreground -- when this exits (Ctrl+C or otherwise)
:: we drop through to the cleanup section.
pushd "%FE_LAUNCH%"
call npm run dev
popd

:: ---- Cleanup: kill the API on its port ----
:: Find whichever PID is listening on :API_PORT and terminate it.
:: Uvicorn's --reload spawns a child worker; both get killed because
:: taskkill /T walks the process tree, but the listening-PID approach
:: above usually only matches the worker.  Use taskkill /T for safety.
echo.
echo Shutting down API ...
for /f "tokens=5" %%a in (
    'netstat -ano ^| findstr ":%API_PORT% " ^| findstr "LISTENING"'
) do (
    taskkill /F /T /PID %%a >nul 2>&1
)
exit /b 0

:: ---- helper ----
:copy_one
if exist "%FE_REPO%\%~1" copy /Y "%FE_REPO%\%~1" "%FE_LAUNCH%\%~1" >nul
exit /b 0

:: ---- error labels ----
:err_venv
echo ERROR: venv not found at %VENV_DIR%
echo Run setup.bat first.
pause
exit /b 1

:err_nm
echo ERROR: node_modules not found at %FE_LAUNCH%\node_modules
echo Run setup.bat first.
pause
exit /b 1

:err_src
echo ERROR: src junction missing at %FE_LAUNCH%\src
echo Run setup.bat first.
pause
exit /b 1

:err_backend
echo ERROR: backend\main.py not found in repo.
pause
exit /b 1
