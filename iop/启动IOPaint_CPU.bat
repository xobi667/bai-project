@echo off
chcp 65001 >nul
title IOPaint Server (CPU Mode)

cd /d "%~dp0"

echo ========================================
echo     IOPaint 背景移除/修复服务器
echo ========================================
echo.

set HF_ENDPOINT=https://mirrors.tuna.tsinghua.edu.cn/hugging-face
set HF_HOME=../models
set PYTHONPATH=.;%PYTHONPATH%

echo [1/2] 正在启动 IOPaint...
echo 模型: lama
echo 设备: cpu
echo 端口: 8080
echo.

set "PYTHON_EXE=%~dp0..\python_portable\python.exe"
"%PYTHON_EXE%" -m iopaint start --model lama --device cpu --port 8080

if %errorlevel% neq 0 (
    echo [错误] IOPaint 启动失败，请检查环境或模型。
    pause
)
