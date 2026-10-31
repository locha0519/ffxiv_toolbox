@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo 找不到 python。請先安裝 Python 3，再點這個檔案。
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:8766/?v=13"
python scripts\serve.py
if errorlevel 1 (
  echo.
  echo 伺服器沒有啟動。如果畫面寫位址已被使用，代表已經有一個視窗在跑，直接開瀏覽器即可。
  pause
)
