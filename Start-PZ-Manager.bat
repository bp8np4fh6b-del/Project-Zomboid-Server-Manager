@echo off
:: PZ Server Manager - Launcher
:: Double-click this to run the app

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies for the first time...
    echo This may take 2-3 minutes.
    echo.
    call npm install --include=dev
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
    echo.
)

if not exist "dist\main.js" (
    echo Building app for the first time...
    call npm run build
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Build failed.
        pause
        exit /b 1
    )
    echo.
)

echo Starting PZ Server Manager...
call npm run start
