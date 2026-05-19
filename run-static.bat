@echo off
setlocal

:: ============================================================
::  Bringe static-build preview
::
::  Three steps:
::    1. Run backend/export_static.py to dump the live SQLite DB
::       into frontend/public/data/*.json.
::    2. Sync the snapshot into the launch pad so the local Vite
::       build picks it up (the dev architecture junctions src/
::       but not public/, so we just copy public/ each time).
::    3. Build the frontend with VITE_STATIC_MODE=1 and serve
::       the resulting dist/ via `npm run preview`.
::
::  This is intended for *previewing* what will go to Render --
::  nothing here changes your live dev flow. Stop the preview
::  with Ctrl+C.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

set "LOCAL_BASE=%LOCALAPPDATA%\bringe"
set "VENV_DIR=%LOCAL_BASE%\backend-venv"
set "FE_LAUNCH=%LOCAL_BASE%\frontend"
set "FE_REPO=%REPO%\frontend"

:: ---- Preflight ----
if not exist "%VENV_DIR%\Scripts\python.exe" goto :err_venv
if not exist "%FE_LAUNCH%\node_modules"       goto :err_nm
if not exist "%FE_LAUNCH%\src"                goto :err_src
if not exist "%REPO%\backend\export_static.py" goto :err_export_script

echo ============================================
echo  Bringe ^| Static-build preview
echo ============================================
echo.

:: ---- Sync the latest configs into the launch pad (same as run.bat) ----
call :copy_one package.json
call :copy_one vite.config.js
call :copy_one tailwind.config.js
call :copy_one postcss.config.js
call :copy_one index.html

:: ============================================================
:: [1/3] Refresh JSON snapshot from local SQLite
:: ============================================================
echo [1/3] Exporting snapshot from local DB ...
call "%VENV_DIR%\Scripts\activate.bat"
cd /d "%REPO%\backend"
python export_static.py
if errorlevel 1 goto :err_export
echo.

:: ============================================================
:: [2/3] Copy public/ (including data/) into the launch pad
:: ============================================================
echo [2/3] Syncing snapshot into the launch pad ...
if not exist "%FE_LAUNCH%\public" mkdir "%FE_LAUNCH%\public"
:: /E copies subdirs (including empty), /I treats target as dir,
:: /Y suppresses overwrite prompts, /Q is quiet.
xcopy "%FE_REPO%\public" "%FE_LAUNCH%\public" /E /Y /I /Q >nul
if errorlevel 1 goto :err_copy
echo   Done.
echo.

:: ============================================================
:: [3/3] Build with VITE_STATIC_MODE=1 and serve
:: ============================================================
echo [3/3] Building static bundle ^(VITE_STATIC_MODE=1^) ...
cd /d "%FE_LAUNCH%"
set "VITE_STATIC_MODE=1"
call npm run build
if errorlevel 1 goto :err_build
echo.

echo ============================================
echo  Build complete. Starting preview server.
echo  Open http://localhost:4173 to see the static build.
echo  Settings cog should be hidden; everything else works
echo  against the JSON snapshot under /data/.
echo  Press Ctrl+C to stop.
echo ============================================
echo.
call npm run preview -- --port 4173 --host 127.0.0.1
goto :eof

:: ---- helper ----
:copy_one
if exist "%FE_REPO%\%~1" copy /Y "%FE_REPO%\%~1" "%FE_LAUNCH%\%~1" >nul
exit /b 0

:: ---- error labels ----
:err_venv
echo ERROR: Python venv missing at %VENV_DIR%
echo Run setup.bat first.
pause
exit /b 1

:err_nm
echo ERROR: node_modules missing at %FE_LAUNCH%\node_modules
echo Run setup.bat first.
pause
exit /b 1

:err_src
echo ERROR: src junction missing at %FE_LAUNCH%\src
echo Run setup.bat first.
pause
exit /b 1

:err_export_script
echo ERROR: backend\export_static.py not found in repo.
pause
exit /b 1

:err_export
echo.
echo ERROR: export_static.py failed.
pause
exit /b 1

:err_copy
echo.
echo ERROR: copying public/ into the launch pad failed.
pause
exit /b 1

:err_build
echo.
echo ERROR: npm run build failed.
pause
exit /b 1
