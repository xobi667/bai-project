# -*- mode: python ; coding: utf-8 -*-
import os
import sys

# 获取当前基础目录
BASE_DIR = os.path.dirname(os.path.abspath(SPEC))
PROJECT_DIR = os.path.dirname(BASE_DIR)

block_cipher = None

# 分析与添加数据
a = Analysis(
    [os.path.join(PROJECT_DIR, 'test_umiocr.py')],
    pathex=[PROJECT_DIR],
    binaries=[],
    datas=[
        (os.path.join(PROJECT_DIR, 'favicon.ico'), '.'),
        (os.path.join(PROJECT_DIR, 'static'), 'static'),
        (os.path.join(PROJECT_DIR, 'templates'), 'templates'),
        (os.path.join(PROJECT_DIR, 'iop'), 'iop'),
        (os.path.join(PROJECT_DIR, 'models'), 'models'),
        (os.path.join(PROJECT_DIR, 'python_portable'), 'python_portable'),
        (os.path.join(PROJECT_DIR, 'umi_ocr'), 'umi_ocr'),
    ],
    hiddenimports=[
        'flask', 'requests', 'cv2', 'PIL', 'numpy', 'werkzeug', 'jinja2', 'json', 
        'base64', 'io', 'threading', 'webbrowser', 'subprocess', 'uuid', 'datetime', 'random', 'hashlib'
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
    [],
    exclude_binaries=True,
    name='小白の翻译',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=r'e:\xobi_io\xobi.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='小白',
)
