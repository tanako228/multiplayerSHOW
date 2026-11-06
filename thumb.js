// Скрытое окно картинок слайдов для пульта с телефона (main.js: rmThumb)
const stage = document.getElementById('stage');

window.api.onThumbDraw(async (content) => {
  stage.replaceChildren();
  if (content && content.style) content.style = { ...content.style, bgVideo: false, bgUrl: content.style.bgVideo ? '' : content.style.bgUrl, still: true };
  let layer = null;
  try { layer = Scene.build(content || { type: 'text', text: ' ' }); } catch { layer = null; }
  if (layer) {
    stage.append(layer);
    Scene.refit(stage);
    // Картинки и первый кадр видео — дождаться (не дольше 2 с)
    const wait = [...layer.querySelectorAll('img, video')].map((m) => new Promise((ok) => {
      if (m.tagName === 'VIDEO') { m.muted = true; m.pause(); if (m.readyState >= 2) return ok(); m.addEventListener('loadeddata', ok, { once: true }); }
      else { if (m.complete) return ok(); m.addEventListener('load', ok, { once: true }); }
      m.addEventListener('error', ok, { once: true });
    }));
    await Promise.race([Promise.all(wait), new Promise((ok) => setTimeout(ok, 2000))]);
    if (document.fonts) await document.fonts.ready;
    Scene.refit(stage);
  }
  // Два кадра — чтобы подгонка текста успела
  requestAnimationFrame(() => requestAnimationFrame(() => window.api.thumbReady()));
});
