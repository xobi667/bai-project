@echo off
chcp 65001 >nul
title Xobi Image Translator

echo ========================================
echo     Xobi Image Translator
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查Python环境...
if not exist venv\Scripts\python.exe (
    echo [错误] 虚拟环境不存在
    pause
    exit /b 1
)
echo [OK] 虚拟环境已就绪

echo [2/3] 启动服务器...
echo.
echo   访问地址: http://localhost:5001
echo   按 Ctrl+C 可停止服务器
echo ========================================
echo.

REM 3秒后自动打开浏览器
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5001"

REM 使用venv中的python启动Flask
venv\Scripts\python.exe test_umiocr.py
