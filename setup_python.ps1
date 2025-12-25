
$ErrorActionPreference = "Stop"

# 使用相对路径，避免非ASCII字符路径解析问题
$workDir = Get-Location
$pythonDir = Join-Path $workDir "python_portable"
$zipUrl = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"
$zipPath = Join-Path $workDir "python.zip"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$getPipPath = Join-Path $pythonDir "get-pip.py"

Write-Host "Work Directory: $workDir"
Write-Host "Python Directory: $pythonDir"

Write-Host "Creating directory..."
if (!(Test-Path $pythonDir)) { New-Item -ItemType Directory -Path $pythonDir | Out-Null }

Write-Host "Downloading Python 3.10 Embeddable..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

Write-Host "Extracting Python..."
Expand-Archive -Path $zipPath -DestinationPath $pythonDir -Force
Remove-Item $zipPath

Write-Host "Configuring python310._pth to enable site-packages..."
$pthFile = Join-Path $pythonDir "python310._pth"
$content = Get-Content $pthFile
$content = $content -replace "#import site", "import site"
Set-Content -Path $pthFile -Value $content

Write-Host "Downloading get-pip.py..."
Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath

Write-Host "Installing pip..."
& "$pythonDir\python.exe" $getPipPath

Write-Host "Installing PyTorch (CUDA 12.1)..."
& "$pythonDir\python.exe" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

Write-Host "Installing IOPaint..."
& "$pythonDir\python.exe" -m pip install iopaint

Write-Host "Done!"
