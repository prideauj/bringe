@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  Bringe -- publish to git (triggers Render auto-deploy)
::
::  Workflow:
::    1. Refresh the static snapshot from the local SQLite DB.
::       (Unless /nosnapshot is passed -- code-only commits.)
::    2. git add -A   (.gitignore excludes backend/*.db, node_modules
::                     and package-lock so this is safe.)
::    3. Show pending changes for sanity.
::    4. git commit -m <message>
::    5. git push
::
::  Usage:
::    push.bat                       prompts for a commit message
::    push.bat "your message"        uses that message
::    push.bat /nosnapshot "msg"     skips the snapshot refresh
::
::  Render is watching the remote branch; once the push lands it
::  rebuilds and ships within ~30 seconds.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"

set "LOCAL_BASE=%LOCALAPPDATA%\bringe"
set "VENV_DIR=%LOCAL_BASE%\backend-venv"

:: ---- arg parsing ----
set "DO_SNAPSHOT=1"
set "MSG="
if /i "%~1"=="/nosnapshot" (
    set "DO_SNAPSHOT=0"
    set "MSG=%~2"
) else (
    set "MSG=%~1"
)

if "%MSG%"=="" (
    set /p MSG="Commit message: "
)
if "%MSG%"=="" goto :err_no_msg

:: ---- preflight ----
where git >nul 2>&1
if errorlevel 1 goto :err_no_git
if not exist "%REPO%\.git" goto :err_no_repo

:: ============================================================
:: [1/4] Refresh snapshot (optional)
:: ============================================================
if "%DO_SNAPSHOT%"=="1" (
    if not exist "%VENV_DIR%\Scripts\python.exe" goto :err_venv
    if not exist "%REPO%\backend\export_static.py" goto :err_no_export
    echo [1/4] Refreshing snapshot from local DB ...
    call "%VENV_DIR%\Scripts\activate.bat"
    python "%REPO%\backend\export_static.py"
    if errorlevel 1 goto :err_export
    echo.
) else (
    echo [1/4] Skipping snapshot refresh ^(/nosnapshot^).
    echo.
)

:: ============================================================
:: [2/4] Stage everything
:: ============================================================
:: GDrive's drive doesn't record POSIX-style ownership, so git's
:: safe.directory check refuses to operate on this repo by default.
:: Whitelist this directory globally before staging. The command is
:: idempotent (git skips duplicate entries) so running it every time
:: is harmless. We pass the path with forward slashes because that's
:: the form git's own "How to fix" message uses.
set "REPO_FWD=%REPO:\=/%"
git config --global --add safe.directory "%REPO_FWD%" >nul 2>&1

echo [2/4] Staging changes ...
git add -A
if errorlevel 1 goto :err_git_add

:: ============================================================
:: [3/4] Show what's about to be committed
:: ============================================================
echo.
echo [3/4] Pending changes:
echo --------------------------------------------
git status -s
echo --------------------------------------------
echo.

:: Bail early if nothing changed.
git diff --cached --quiet
if not errorlevel 1 (
    echo Nothing to commit. Working tree is clean.
    pause
    exit /b 0
)

set /p CONFIRM="Proceed with commit and push? [Y/n] "
if /i "!CONFIRM!"=="n" goto :cancel

:: ============================================================
:: [4/4] Commit + push
:: ============================================================
echo.
echo [4/4] Committing and pushing ...
git commit -m "%MSG%"
if errorlevel 1 goto :err_commit
git push
if errorlevel 1 goto :err_push

echo.
echo ============================================
echo  Pushed. Render will rebuild from the remote
echo  branch within ~30s.
echo ============================================
pause
exit /b 0

:cancel
echo Cancelled. Nothing was committed or pushed.
echo You can run `git reset` if you want to unstage.
pause
exit /b 0

:: ---- error labels ----
:err_no_msg
echo ERROR: commit message is required.
pause
exit /b 1

:err_no_git
echo ERROR: git is not installed or not on PATH.
pause
exit /b 1

:err_no_repo
echo ERROR: %REPO% is not a git repository.
echo Run `git init` and add a remote first.
pause
exit /b 1

:err_venv
echo ERROR: Python venv missing at %VENV_DIR%
echo Run setup.bat first, or pass /nosnapshot to skip the snapshot step.
pause
exit /b 1

:err_no_export
echo ERROR: backend\export_static.py not found.
pause
exit /b 1

:err_export
echo.
echo ERROR: export_static.py failed.
pause
exit /b 1

:err_git_add
echo.
echo ERROR: git add failed.
pause
exit /b 1

:err_commit
echo.
echo ERROR: git commit failed.
pause
exit /b 1

:err_push
echo.
echo ERROR: git push failed.
echo Common causes: no upstream branch, network, auth.
echo Try `git push -u origin main` once manually to set the upstream.
pause
exit /b 1
