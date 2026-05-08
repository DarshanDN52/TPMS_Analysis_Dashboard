@echo off
TITLE TPMS Dashboard Stopper
echo ==========================================
echo   Stopping TPMS Analysis Dashboard
echo ==========================================

REM Ensure we are in the script's directory
pushd "%~dp0"

echo [1/2] Stopping Backend (Port 8000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    echo Killing Process ID: %%a
    taskkill /F /PID %%a 2>nul
)

echo [2/2] Stopping Frontend (Port 5000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do (
    echo Killing Process ID: %%a
    taskkill /F /PID %%a 2>nul
)

echo.
echo ==========================================
echo   All services stopped.
echo ==========================================
echo.
popd
pause
