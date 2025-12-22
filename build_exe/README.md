# Xobi Image Translator 打包说明

## 📦 打包步骤

1. **双击运行** `打包成exe.bat`
2. 等待打包完成（大约需要2-5分钟）
3. 打包完成后，可执行文件位于 `dist\XobiImageTranslator.exe`

## 📋 分发给朋友

将以下文件/文件夹发送给您的朋友：
- `dist\XobiImageTranslator.exe` （约 50-100MB）

## ⚠️ 使用前提条件

您的朋友需要：
1. **Umi-OCR** - 本地OCR服务（免费）
   - 下载地址：https://github.com/hiroi-sora/Umi-OCR
   - 安装后需要开启 HTTP 服务端（默认端口 1224）

2. **网络连接** - 用于访问 Google 翻译 API

## 🚀 使用方法

1. 先启动 Umi-OCR 并开启 HTTP 服务
2. 双击 `XobiImageTranslator.exe`
3. 程序会自动打开浏览器（http://localhost:5001）
4. 上传图片，选择语言，开始翻译

## 🔧 常见问题

**Q: 提示"找不到OCR服务"？**
A: 确保 Umi-OCR 已启动且 HTTP 服务端口为 1224

**Q: 翻译失败？**
A: 检查网络连接，确保能访问 Google 翻译

**Q: 程序闪退？**
A: 以管理员身份运行，或检查杀毒软件是否误杀

## 📁 文件说明

```
build_exe/
├── XobiTranslator.spec    # PyInstaller 配置文件
├── 打包成exe.bat          # 一键打包脚本
└── README.md              # 本说明文件
```

打包后生成：
```
dist/
└── XobiImageTranslator.exe  # 可分发的独立程序
```
