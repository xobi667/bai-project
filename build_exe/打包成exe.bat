@echo off
chcp 65001 >nul
title 打包 Xobi Image Translator

echo ========================================
echo     Xobi Image Translator 打包工具
echo ========================================
echo.

cd /d "%~dp0\.."

echo [1/4] 检查虚拟环境...
if not exist venv\Scripts\python.exe (
    echo [错误] 虚拟环境不存在，请先运行项目
    pause
    exit /b 1
)
echo [OK] 虚拟环境已就绪
echo.

echo [2/4] 安装 PyInstaller...
venv\Scripts\pip.exe install pyinstaller -q
if errorlevel 1 (
    echo [错误] PyInstaller 安装失败
    pause
    exit /b 1
)
echo [OK] PyInstaller 已安装
echo.

echo [3/4] 开始打包...
echo 这可能需要几分钟时间，请耐心等待...
echo.

venv\Scripts\pyinstaller.exe --clean --noconfirm build_exe\XobiTranslator.spec

if errorlevel 1 (
    echo.
    echo [错误] 打包失败，请检查错误信息
    pause
    exit /b 1
)

echo.
echo ========================================
echo [4/4] 打包完成！
echo ========================================
echo.
echo 可执行文件位置: dist\小白\小白の翻译.exe
echo.
echo 使用方法:
echo   1. 将 dist\小白 文件夹 整个 复制或压缩给您的朋友
echo   2. 对方解压后，进入文件夹，双击 “小白の翻译.exe” 运行
echo   3. 程序会自动启动所有依赖服务（可能需要10-20秒初始化）
echo.
echo 注意: 
echo   - 本版本已内置 Umi-OCR 和 AI 修复引擎，无需额外安装
echo   - 第一次运行可能会被防火墙拦截，请允许访问网络（本地通信用）
echo.
pause
