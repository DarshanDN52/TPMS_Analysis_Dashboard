@echo off
SETLOCAL EnableExtensions
TITLE TPMS Dashboard Starter

echo ==========================================
echo   Starting TPMS Analysis Dashboard
echo ==========================================

REM Ensure we are in the script's directory
pushd "%~dp0"

REM Check if .venv exists (Avoid IF NOT EXIST to prevent syntax issues)
IF EXIST ".venv" GOTO :VENV_FOUND

echo [ERROR] Virtual environment (.venv) not found.
echo Please create it first using: python -m venv .venv
pause
popd
exit /b

:VENV_FOUND
REM Check if Frontend dependencies are installed
IF EXIST "Frontend\node_modules" GOTO :FRONTEND_OK
echo [ERROR] Frontend dependencies (node_modules) not found.
echo Please run "npm install" in the Frontend directory first.
pause
popd
exit /b

:FRONTEND_OK
REM Start Backend in a new window
echo [1/2] Starting Backend Server...
start "TPMS Backend" cmd /k "call .venv\Scripts\activate && python -m uvicorn Backend.app.main:app --host 0.0.0.0 --port 8000 --reload"

REM Wait a moment for backend to initialize
timeout /t 3 /nobreak > nul

REM Start Frontend in a new window
echo [2/2] Starting Frontend Server...
start "TPMS Frontend" cmd /k "cd Frontend && npm run dev"

echo.
echo ==========================================
echo   Services are starting up!
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5000
echo ==========================================
echo.
echo Press any key to exit this starter script.
pause > nul
popd
