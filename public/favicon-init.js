// public/favicon-init.js
const initDynamicFavicon = () => {
  const img = new Image();
  img.src = '/favicon.png';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw a sleek rounded squircle badge so the dark hand pops in dark browser tabs
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(2, 2, 60, 60, 16);
    } else {
      ctx.rect(2, 2, 60, 60);
    }
    ctx.fill();
    ctx.stroke();

    // Zoom in 2.1x on the center of favicon.png to crop out the empty transparent margins
    const zoom = 2.1;
    const sw = img.width / zoom;
    const sh = img.height / zoom;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 4, 4, 56, 56);

    const link = document.getElementById('dynamic-favicon');
    if (link) link.href = canvas.toDataURL('image/png');
  };
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initDynamicFavicon, { once: true });
} else {
  initDynamicFavicon();
}