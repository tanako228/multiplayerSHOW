// Заставка от выгорания OLED: часы и логотип тусклые и не стоят на месте (пиксели не горят подолгу одно и то же)
const kind = new URLSearchParams(location.search).get('kind');
if (kind === 'black') document.documentElement.classList.add('black');
const box = document.getElementById('box');
const pad = (n) => String(n).padStart(2, '0');

function tick() {
  const d = new Date();
  document.getElementById('time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById('date').textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Новое случайное место: гаснет, переезжает, загорается
function move() {
  box.classList.remove('on');
  setTimeout(() => {
    const w = Math.max(0, innerWidth - box.offsetWidth);
    const h = Math.max(0, innerHeight - box.offsetHeight);
    box.style.left = Math.round(Math.random() * w) + 'px';
    box.style.top = Math.round(Math.random() * h) + 'px';
    box.classList.add('on');
  }, 1600);
}

tick();
setInterval(tick, 5000);
if (kind !== 'black') { move(); setInterval(move, 20000); }
