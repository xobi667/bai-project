# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 打包配置文件

import os
import sys

# 获取当前目录
BASE_DIR = os.path.dirname(os.path.abspath(SPEC))
PROJECT_DIR = os.path.dirname(BASE_DIR)

block_cipher = None

# 主程序
a = Analysis(
    [os.path.join(PROJECT_DIR, 'test_umiocr.py')],
    pathex=[PROJECT_DIR],
    binaries=[],
    datas=[
        # 包含静态文件
        (os.path.join(PROJECT_DIR, 'static'), 'static'),
        # 包含模板文件
        (os.path.join(PROJECT_DIR, 'templates'), 'templates'),
    ],
    hiddenimports=[
        'flask',
        'requests',
        'cv2',
        'PIL',
        'numpy',
        'werkzeug',
        'jinja2',
        'json',
        'base64',
        'io',
        'threading',
        'webbrowser',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='XobiImageTranslator',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # 显示控制台窗口，方便调试
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(PROJECT_DIR, 'xobi.ico'),  # 使用项目图标
)
