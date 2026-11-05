@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Выложить новую версию на GitHub: сохранить правки, поднять номер версии, отправить.
rem GitHub сам соберёт установщик (минут 5–10) — потом другие компьютеры смогут обновиться.

where git >nul 2>nul || (echo Не найден Git. Установите: winget install --id Git.Git -e & pause & exit /b 1)

echo.
echo === Выпуск новой версии multiplayerSHOW ===
echo.
set /p NOTE=Коротко, что изменилось (можно пусто):
if "%NOTE%"=="" set NOTE=Изменения

git add -A
git commit -m "%NOTE%" >nul 2>nul
call npm version patch -m "Версия %%s: %NOTE%" || (echo Не удалось поднять версию. & pause & exit /b 1)
git push --follow-tags || (echo Не удалось отправить на GitHub — проверьте интернет и вход в GitHub. & pause & exit /b 1)

echo.
echo Готово. GitHub собирает установщик — через 5–10 минут он появится в разделе Releases.
echo На других компьютерах: Настройки → Обновление программы → «Проверить обновления».
pause
