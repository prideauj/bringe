@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  Bringe -- publish to git (triggers Render auto-deploy)
::
::  Steps:
::    [1/5] Refresh the static snapshot from local SQLite.
::          (skip with /nosnapshot for code-only commits)
::    [2/5] Untrack any committed files that the *current* .gitignore
::          marks as ignored.  Files added to the index before the
::          .gitignore was updated stay tracked forever otherwise --
::          this is the reason .venv contents kept showing up on
::          GitHub even after the ignore rules were added.
::    [3/5] Stage outstanding changes (git add -A).
::    [4/5] Print pending changes and ask for confirmation.
::    [5/5] Commit + push.  Auto-falls-back to `git push -u origin
::          <branch>` if no upstream is configured.
::
::  Usage:
::    push.bat                       prompts for a commit message
::    push.bat "your message"        uses that message
::    push.bat /nosnapshot "msg"     skips the snapshot refresh
::
::  Render watches the remote branch; once the push lands it
::  rebuilds and ships within ~30 seconds.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"
set "REPO_FWD=%REPO:\=/%"

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

:: ---- preflight ----
where git >nul 2>&1
if errorlevel 1 goto :err_no_git
if not exist "%REPO%\.git" goto :err_no_repo

:: Trust GDrive path (idempotent; needed because GDrive's drive
:: doesn't record ownership and git refuses by default).
git config --global --add safe.directory "%REPO_FWD%" >nul 2>&1

:: ============================================================
:: [1/5] Refresh snapshot
:: ============================================================
if "%DO_SNAPSHOT%"=="1" (
    if not exist "%VENV_DIR%\Scripts\python.exe" goto :err_venv
    if not exist "%REPO%\backend\export_static.py" goto :err_no_export
    echo [1/5] Refreshing snapshot from local DB ...
    call "%VENV_DIR%\Scripts\activate.bat"
    python "%REPO%\backend\export_static.py"
    if errorlevel 1 goto :err_export
    if exist "%REPO%\frontend\public\data\manifest.json" (
        echo   Snapshot manifest:
        type "%REPO%\frontend\public\data\manifest.json"
        echo.
    )
    echo.
) else (
    echo [1/5] Skipping snapshot refresh ^(/nosnapshot^).
    echo.
)

:: ============================================================
:: [2/5] Untrack files that .gitignore now excludes
:: ============================================================
:: First sweep: bulk removal of the known-large directories. These
:: are the usual culprits when the repo looks bloated on GitHub.
:: `git rm --cached` only updates the index -- working tree files
:: are left alone.
echo [2/5] Untracking files matching .gitignore ...
set "UNTRACKED_ANY=0"

for %%P in (
    backend\.venv
    frontend\node_modules
    frontend\dist
) do (
    if exist "%REPO%\%%P" (
        git ls-files --error-unmatch -- "%%P" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   - untracking %%P\
            git rm -r --cached --quiet -- "%%P" >nul 2>&1
            set "UNTRACKED_ANY=1"
        )
    )
)

:: SQLite DB files and the lockfile -- single files, not dirs.
for %%F in (
    backend\bringe.db
    backend\bringe.db-journal
    backend\bringe.db-wal
    backend\bringe.db-shm
    frontend\package-lock.json
) do (
    git ls-files --error-unmatch -- "%%F" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   - untracking %%F
        git rm --cached --quiet -- "%%F" >nul 2>&1
        set "UNTRACKED_ANY=1"
    )
)

:: Second sweep: thorough catch-all. `git ls-files -ci
:: --exclude-standard` lists every currently-tracked file that
:: matches a .gitignore rule. Anything the hard-coded list above
:: missed (or that the .gitignore later starts excluding) is
:: removed here. Output is sent through a temp file because piping
:: a `for /f` to `git rm` is fragile under cmd.
set "IGNORED_FILE=%TEMP%\bringe_ignored_tracked.txt"
git ls-files -ci --exclude-standard > "%IGNORED_FILE%" 2>nul

set "EXTRA_COUNT=0"
for /f %%c in ('type "%IGNORED_FILE%" 2^>nul ^| find /v /c ""') do set "EXTRA_COUNT=%%c"
if not "%EXTRA_COUNT%"=="0" (
    echo   - untracking %EXTRA_COUNT% additional file^(s^) flagged by .gitignore
    for /f "usebackq tokens=*" %%f in ("%IGNORED_FILE%") do (
        git rm --cached --quiet -- "%%f" >nul 2>&1
    )
    set "UNTRACKED_ANY=1"
)
del "%IGNORED_FILE%" 2>nul

if "%UNTRACKED_ANY%"=="0" echo   None found.
echo.

:: ============================================================
:: [3/5] Stage outstanding changes
:: ============================================================
echo [3/5] Staging changes ...
git add -A
if errorlevel 1 goto :err_git_add

:: ============================================================
:: [4/5] Show + confirm
:: ============================================================
echo.
echo [4/5] Pending changes:
echo --------------------------------------------
git status -s
echo --------------------------------------------
echo.

git diff --cached --quiet
if not errorlevel 1 (
    echo Nothing to commit. Working tree is clean.
    pause
    exit /b 0
)

if "%MSG%"=="" set /p MSG="Commit message: "
if "%MSG%"=="" goto :err_no_msg

set /p CONFIRM="Proceed with commit and push? [Y/n] "
if /i "!CONFIRM!"=="n" goto :cancel

:: ============================================================
:: [5/5] Commit + push (with upstream auto-fallback)
:: ============================================================
echo.
echo [5/5] Committing ...
git commit -m "%MSG%"
if errorlevel 1 goto :err_commit

echo Pushing ...
git push 2>nul
if errorlevel 1 (
    echo   No upstream configured -- retrying with `-u origin ^<branch^>`.
    for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
    git push -u origin !BRANCH!
    if errorlevel 1 goto :err_push
)

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
echo ERROR: git push failed even with `-u origin`.
echo Common causes: network down, auth failure, branch name mismatch
echo on the remote. Try `git push -u origin main` manually to see the
echo full error message.
pause
exit /b 1
