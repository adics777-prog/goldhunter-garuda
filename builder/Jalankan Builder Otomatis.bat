@echo off
title GHG Builder - GoldHunter Garuda (otomatis jalan lagi bila berhenti)
cd /d "%~dp0"
:ulang
python ghg_builder.py
echo [%date% %time%] builder berhenti (kode %errorlevel%), jalan lagi dalam 15 detik>> builder.log
echo Builder berhenti, jalan lagi dalam 15 detik... (tutup jendela ini untuk berhenti total)
timeout /t 15 /nobreak >nul
goto ulang
