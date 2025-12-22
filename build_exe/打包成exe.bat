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
echo 可执行文件位置: dist\XobiImageTranslator.exe
echo.
echo 使用方法:
echo   1. 将 dist\XobiImageTranslator.exe 复制给您的朋友
echo   2. 双击运行即可（需要联网访问翻译API）
echo   3. 程序会自动打开浏览器
echo.
echo 注意: 
echo   - 您的朋友需要有 Umi-OCR 服务端运行
echo   - 或者修改代码使用其他OCR服务
echo.
pause
