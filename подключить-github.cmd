@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Один раз: связать эту папку с пустым репозиторием на GitHub и отправить туда программу.

where git >nul 2>nul || (echo Не найден Git. Установите: winget install --id Git.Git -e & pause & exit /b 1)

echo.
echo Создайте на github.com ПУСТОЙ репозиторий (Public, без README) и скопируйте его адрес,
echo например: https://github.com/ваше-имя/multiplayerSHOW.git
echo.
set /p URL=Адрес репозитория:
if "%URL%"=="" (echo Адрес не введён. & pause & exit /b 1)

if not exist ".git" git init -b main
git config user.name >nul 2>nul || git config user.name "multiplayerSHOW"
git config user.email >nul 2>nul || set /p MAIL=Ваша почта для GitHub:
if defined MAIL git config user.email "%MAIL%"

git remote remove origin >nul 2>nul
git remote add origin "%URL%"
git add -A
git commit -m "Первая версия multiplayerSHOW" >nul 2>nul
git push -u origin main || (echo Не удалось отправить. Проверьте адрес и вход в GitHub. & pause & exit /b 1)
git tag v0.1.0 >nul 2>nul
git push origin v0.1.0

echo.
echo Готово. Программа на GitHub. Через 5–10 минут в разделе Releases появится установщик.
pause
