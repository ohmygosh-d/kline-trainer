@echo off
chcp 65001 >nul
title K线练习助手 - 数据服务器
set http_proxy=
set https_proxy=
set HTTP_PROXY=
set HTTPS_PROXY=
set all_proxy=
set ALL_PROXY=
set no_proxy=*

echo ========================================================
echo   K线练习助手 — 全市场随机选股数据服务器
echo ========================================================
echo.
echo   正在启动服务器...
echo.

python server.py

pause
