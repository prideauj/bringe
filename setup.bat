@echo off
setlocal

:: ============================================================
::  Bringe -- First-time (and re-)setup
::
::  Storage layout:
::    REPO (synced on GDrive)
::      D:\gdrive\...\bringe\
::         backend\          <-- runs in place; only the venv is local
::         frontend\
::            src\           <-- canonical source files (synced)
::            package.json   <-- canonical configs (synced)
::            vite.config.js
::            tailwind.config.js
::            postcss.config.js
::            index.html
::
::    Launch pad (local, per-machine)
::      %LOCALAPPDATA%\bringe\
::         backend-venv\     <-- Python venv
::         frontend\         <-- where `npm run dev` actually runs
::            node_modules\  <-- real npm install
::            src\           <-- NTFS junction --> REPO\frontend\src
::            package.json   <-- copy, refreshed each run
::            vite.config.js
::            tailwind.config.js
::            postcss.config.js
::            index.html
::
::  Why this shape: GoogleDrive's DriveFS volume can't host NTFS reparse
::  points, so we can't put node_modules on REPO\frontend via a junction.
::  Instead the launch pad on C:\ (NTFS) is the working dir; src\ is a
::  junction pointing AT the GDrive copy so file edits round-trip
::  through the GDrive sync transparently.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

set "LOCAL_BASE=%LOCALAPPDATA%\bringe"
set "VENV_DIR=%LOCAL_BASE%\backend-venv"
set "FE_LAUNCH=%LOCAL_BASE%\frontend"
set "FE_LAUNCH_SRC=%FE_LAUNCH%\src"
set "FE_REPO=%REPO%\frontend"
set "FE_REPO_SRC=%FE_REPO%\src"

echo ============================================================
echo  Bringe -- Setup
echo  Repo (synced) : %REPO%
echo  Local store   : %LOCAL_BASE%
echo ============================================================
echo.

if not exist "%LOCAL_BASE%"  mkdir "%LOCAL_BASE%"
if not exist "%FE_LAUNCH%"   mkdir "%FE_LAUNCH%"

:: ============================================================
:: [1/4] Python virtual environment
:: ============================================================
echo [1/4] Python virtual environment ...
if exist "%VENV_DIR%\Scripts\python.exe" goto :pip_install
echo   Creating venv at %VENV_DIR%
python -m venv "%VENV_DIR%"
if errorlevel 1 goto :err_venv

:pip_install
echo   Installing packages from requirements.txt ...
"%VENV_DIR%\Scripts\pip" install -q -r "%REPO%\backend\requirements.txt"
if errorlevel 1 goto :err_pip
echo   Done.
echo.

:: ============================================================
:: [2/4] Copy frontend config files to launch pad
:: ============================================================
echo [2/4] Copying frontend config files to launch pad ...
call :copy_one package.json
call :copy_one vite.config.js
call :copy_one tailwind.config.js
call :copy_one postcss.config.js
call :copy_one index.html
echo   Done.
echo.

:: ============================================================
:: [3/4] Junction launch-pad\src -> repo\frontend\src
:: ============================================================
echo [3/4] Linking src into the launch pad ...
if not exist "%FE_LAUNCH_SRC%" goto :do_link_src
:: rmdir without /S removes empty dirs OR junctions, refuses real
:: non-empty directories. Safety net against trampling local edits.
rmdir "%FE_LAUNCH_SRC%" 2>nul
if exist "%FE_LAUNCH_SRC%" goto :err_src_real_dir

:do_link_src
mklink /J "%FE_LAUNCH_SRC%" "%FE_REPO_SRC%" >nul
if errorlevel 1 goto :err_link_src
echo   Junction: %FE_LAUNCH_SRC%
echo         -^> %FE_REPO_SRC%
echo.

:: ============================================================
:: [4/4] npm install in the launch pad
:: ============================================================
echo [4/4] npm install ...
cd /d "%FE_LAUNCH%"
call npm install
if errorlevel 1 goto :err_npm
cd /d "%REPO%"
echo.

echo ============================================================
echo  Setup complete. Run run.bat to start the app.
echo ============================================================
pause
exit /b 0

:: ---- subroutines ----
:copy_one
if exist "%FE_REPO%\%~1" copy /Y "%FE_REPO%\%~1" "%FE_LAUNCH%\%~1" >nul
exit /b 0

:: ---- error labels ----
:err_venv
echo.
echo ERROR: python -m venv failed.
pause
exit /b 1

:err_pip
echo.
echo ERROR: pip install failed.
pause
exit /b 1

:err_src_real_dir
echo.
echo ERROR: A real directory ^(not a junction^) exists at:
echo   %FE_LAUNCH_SRC%
echo Delete it manually and re-run setup.bat.
pause
exit /b 1

:err_link_src
echo.
echo ERROR: mklink /J failed.
echo Junction: %FE_LAUNCH_SRC%
echo Target:   %FE_REPO_SRC%
pause
exit /b 1

:err_npm
echo.
echo ERROR: npm install failed.
pause
exit /b 1
