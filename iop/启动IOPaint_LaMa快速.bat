@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   IOPaint with LaMa Model (FAST MODE)
echo ========================================
echo.
echo LaMa is optimized for text removal - much faster than PowerPaint!
echo First run will download the model (~200MB).
echo.

set HF_ENDPOINT=https://hf-mirror.com
set HF_HOME=../models
set PYTHONPATH=.;%PYTHONPATH%

rem Run IOPaint with LaMa model
..\python_portable\python.exe -m iopaint start --model lama --device cuda --port 8080

if %errorlevel% neq 0 (
    echo.
    echo Failed to start. Trying CPU mode...
    ..\python_portable\python.exe -m iopaint start --model lama --device cpu --port 8080
)
pause
