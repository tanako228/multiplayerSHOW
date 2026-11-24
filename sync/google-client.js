/* Пропуск программы в Google — OAuth-клиент типа «Приложение для ПК» (Google Cloud Console → Учётные данные).
   Он один на всю программу и вшивается в сборку: это «имя программы» для Google, а не аккаунт. Каждый пользователь
   входит в СВОЙ аккаунт, данные лежат в скрытой папке приложения на ЕГО Диске; владелец пропуска их не видит.
   У «ПК»-клиентов Google секрет не считается секретным (он есть в каждой копии программы), но нужен при входе.
   Пока не заполнено — в окне «Облако» можно вписать свой пропуск (хранится в <папка программы>\cloud\google-client.json). */
'use strict';
module.exports = {
  // Проект Google Cloud «multiplayerSHOW» (ID multiplayershow), клиент «multiplayerSHOW Desktop». Переменные окружения — для проверки чужого пропуска.
  clientId: process.env.MPS_GOOGLE_CLIENT_ID || '211898217991-ctgu5q39bksrblub5th3rhmgnu1tjk30.apps.googleusercontent.com',
  clientSecret: process.env.MPS_GOOGLE_CLIENT_SECRET || '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',
};
