@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Starting IOPaint with PowerPaint model (CUDA)...
echo Please wait, this may take a while to download the model (5GB) on first run.

set HF_ENDPOINT=https://hf-mirror.com
set HF_HOME=../models
set PYTHONPATH=.;%PYTHONPATH%

rem Run IOPaint
..\python_portable\python.exe -m iopaint start --model Sanster/PowerPaint-V1-stable-diffusion-inpainting --device cuda --port 8080

if %errorlevel% neq 0 (
    echo.
    echo Fail to start.
    pause
)
pause
