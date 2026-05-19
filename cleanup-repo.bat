@echo off
setlocal

:: ============================================================
::  Bringe -- one-shot repo cleanup
::
::  Run this once to drop the cruft I spotted on GitHub:
::    * .claude\settings.local.json  -- Claude Code agent state
::    * backend\start-api.bat        -- obsolete (run.bat replaced it)
::    * shows_theatre.json           -- debug artifact from filter dbg
::
::  Doesn't commit on its own; runs push.bat at the end so you get
::  the usual confirm/diff prompt and a single commit.
:: ============================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"

echo ============================================
echo  Repo cleanup
echo ============================================

:: Obsolete file 1: the old standalone API launcher.
if exist "%REPO%\backend\start-api.bat" (
    del /Q "%REPO%\backend\start-api.bat"
    echo   deleted backend\start-api.bat
)

:: Obsolete file 2: debug snapshot we curled into the repo root.
if exist "%REPO%\shows_theatre.json" (
    del /Q "%REPO%\shows_theatre.json"
    echo   deleted shows_theatre.json
)

:: The .claude\ directory: leave the files on disk (Claude Code uses
:: them locally) but make sure .gitignore picks them up. push.bat's
:: untracker will remove them from the index on the next run.
echo   .claude\ left on disk; .gitignore now excludes it -- push.bat
echo     will untrack it on the next run.

echo.
echo Handing off to push.bat for the commit ...
echo.
call "%REPO%\push.bat" /nosnapshot "repo cleanup: drop .claude, obsolete start-api.bat, debug shows_theatre.json"
endlocal
