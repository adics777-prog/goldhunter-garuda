@echo off
REM Membuat builder otomatis berjalan setiap Windows login (shortcut di folder Startup).
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\GHG Builder.lnk'); $s.TargetPath='%~dp0Jalankan Builder.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo Builder akan otomatis berjalan setiap Windows menyala.
echo Untuk mematikan: hapus "GHG Builder" dari folder %STARTUP%
pause
