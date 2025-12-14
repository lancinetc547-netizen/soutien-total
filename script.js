// Pong — Effets visuels supplémentaires : screen shake, post-process blur, particules avancées et traînée
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Score elements
  const leftScoreEl = document.getElementById('leftScore');
  const rightScoreEl = document.getElementById('rightScore');
  const soundToggle = document.getElementById('soundToggle');
  const volumeInput = document.getElementById('volume');
  const resetBtn = document.getElementById('resetBtn');

  // Touch buttons
  const touchUp = document.getElementById('touchUp');
  const touchDown = document.getElementById('touchDown');
  const touchControls = document.getElementById('touchControls');

  const W = canvas.width;
  const H = canvas.height;

  // Offscreen buffer for post-processing
  const buffer = document.createElement('canvas');
  buffer.width = W;
  buffer.height = H;
  const bctx = buffer.getContext('2d');

  // Game objects
  const paddle = { width: 12, height: 90, x: 20, y: (H - 90) / 2, speed: 6, vy: 0 };
  const ai = { width: 12, height: 90, x: W - 20 - 12, y: (H - 90) / 2, speed: 4.6 };
  const ball = { r: 8, x: W / 2, y: H / 2, speed: 5, vx: 5, vy: 0, speedIncrement: 0.35, maxSpeed: 14 };

  // Visual systems
  const particles = [];
  const ballTrail = []; // trail of previous positions
  const maxTrail = 18;

  let leftScore = 0;
  let rightScore = 0;
  let paused = false;
  let soundEnabled = true;

  // Screen shake
  let shakeTime = 0;
  let shakeMag = 0;

  // Flash overlay (alpha)
  let flashAlpha = 0;

  // Input
  const keys = { ArrowUp: false, ArrowDown: false };
  let lastMouseY = null;
  let touchHold = { up: false, down: false };

  // Audio
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  function createGain() {
    ensureAudio();
    const g = audioCtx.createGain();
    g.gain.value = parseFloat(volumeInput.value || 0.9);
    g.connect(audioCtx.destination);
    return g;
  }
  function playPaddleHit(intensity = 1) {
    if (!soundEnabled) return;
    ensureAudio();
    const g = createGain();
    const o = audioCtx.createOscillator();
    const f = 250 + Math.random() * 300 * intensity;
    o.frequency.value = f;
    o.type = 'sawtooth';
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.6 * intensity, audioCtx.currentTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
    o.connect(env).connect(g);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  }
  function playWallHit() {
    if (!soundEnabled) return;
    ensureAudio();
    const g = createGain();
    const o = audioCtx.createOscillator();
    o.frequency.value = 100 + Math.random() * 80;
    o.type = 'triangle';
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    o.connect(env).connect(g);
    o.start();
    o.stop(audioCtx.currentTime + 0.2);
  }
  function playScore() {
    if (!soundEnabled) return;
    ensureAudio();
    const g = createGain();
    const now = audioCtx.currentTime;
    const freqs = [220, 330, 440];
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0.0001, now + i * 0.06);
      env.gain.exponentialRampToValueAtTime(0.6, now + i * 0.06 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.26);
      o.connect(env).connect(g);
      o.start(now + i * 0.06);
      o.stop(now + i * 0.06 + 0.26);
    });
  }

  // Utils
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function vib(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

  // Ball reset
  function resetBall(servingToLeft = null) {
    ball.x = W / 2; ball.y = H / 2; ball.speed = 5;
    const angle = (Math.random() * 2 - 1) * (Math.PI / 6);
    let dir = (servingToLeft === null) ? (Math.random() < 0.5 ? -1 : 1) : (servingToLeft ? -1 : 1);
    ball.vx = dir * ball.speed * Math.cos(angle);
    ball.vy = ball.speed * Math.sin(angle);
    ballTrail.length = 0;
  }
  function serveAfterDelay(toLeft) {
    paused = true;
    setTimeout(() => { resetBall(toLeft); paused = false; }, 700);
  }

  // Particles
  function spawnParticles(x, y, count = 12, color = '#e6f0ff') {
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() * Math.PI * 2);
      const speed = 0.8 + Math.random() * 3.2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        life: 18 + Math.random() * 28,
        color,
        size: 1 + Math.random() * 3
      });
    }
  }

  // Visual triggers
  function triggerShake(magnitude = 6, duration = 220) {
    shakeMag = Math.max(shakeMag, magnitude);
    shakeTime = Math.max(shakeTime, duration);
  }
  function triggerFlash(alpha = 0.7) {
    flashAlpha = Math.max(flashAlpha, alpha);
  }

  // Drawing utilities
  function roundRect(ctxRef, x, y, w, h, r = 5, fill = true, stroke = false) {
    const min = Math.min(w, h) / 2;
    if (r > min) r = min;
    ctxRef.beginPath();
    ctxRef.moveTo(x + r, y);
    ctxRef.arcTo(x + w, y, x + w, y + h, r);
    ctxRef.arcTo(x + w, y + h, x, y + h, r);
    ctxRef.arcTo(x, y + h, x, y, r);
    ctxRef.arcTo(x, y, x + w, y, r);
    ctxRef.closePath();
    if (fill) ctxRef.fill();
    if (stroke) ctxRef.stroke();
  }
  function drawNet(ctxRef) {
    ctxRef.save();
    ctxRef.strokeStyle = 'rgba(255,255,255,0.06)';
    ctxRef.lineWidth = 2;
    ctxRef.setLineDash([12, 10]);
    ctxRef.beginPath();
    ctxRef.moveTo(W / 2, 10);
    ctxRef.lineTo(W / 2, H - 10);
    ctxRef.stroke();
    ctxRef.restore();
  }
  function drawPaddle(ctxRef, x, y, w, h) {
    ctxRef.fillStyle = 'rgba(220,230,255,0.95)';
    roundRect(ctxRef, x, y, w, h, 5, true, false);
  }
  function drawBallTo(ctxRef) {
    // glow
    const g = ctxRef.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 3);
    g.addColorStop(0, 'rgba(230,240,255,0.95)');
    g.addColorStop(0.6, 'rgba(230,240,255,0.3)');
    g.addColorStop(1, 'rgba(230,240,255,0)');
    ctxRef.fillStyle = g;
    ctxRef.beginPath();
    ctxRef.arc(ball.x, ball.y, ball.r * 2.8, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.fillStyle = '#e6f0ff';
    ctxRef.beginPath();
    ctxRef.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctxRef.fill();
  }

  // Physics & update
  function update() {
    if (!paused) {
      // Player keys
      if (keys.ArrowUp) paddle.vy = -paddle.speed;
      else if (keys.ArrowDown) paddle.vy = paddle.speed;
      else paddle.vy = paddle.vy * 0.85;

      if (touchHold.up) paddle.vy = -paddle.speed;
      if (touchHold.down) paddle.vy = paddle.speed;

      if (lastMouseY !== null) {
        const targetY = lastMouseY - paddle.height / 2;
        const diff = targetY - paddle.y;
        // smoothing yields paddle.vy so spin can be derived
        paddle.vy = diff * 0.35;
        paddle.y += paddle.vy;
      } else {
        paddle.y += paddle.vy;
      }

      paddle.y = clamp(paddle.y, 6, H - paddle.height - 6);
      ai.y = clamp(ai.y, 6, H - ai.height - 6);

      // AI with anticipation
      const aiCenter = ai.y + ai.height / 2;
      const lookAhead = clamp(ball.vx * 10, -70, 70);
      const target = ball.y + lookAhead;
      const delta = target - aiCenter;
      ai.y += clamp(delta * 0.12, -ai.speed, ai.speed);

      // movement
      ball.x += ball.vx;
      ball.y += ball.vy;

      // store trail (for motion blur / trail)
      ballTrail.unshift({ x: ball.x, y: ball.y, a: 1 });
      if (ballTrail.length > maxTrail) ballTrail.pop();

      // top/bottom collision
      if (ball.y - ball.r <= 0) {
        ball.y = ball.r;
        ball.vy = -ball.vy;
        playWallHit();
        vib(10);
        spawnParticles(ball.x, ball.y, 10, '#9be7ff');
        triggerShake(3, 140);
      } else if (ball.y + ball.r >= H) {
        ball.y = H - ball.r;
        ball.vy = -ball.vy;
        playWallHit();
        vib(10);
        spawnParticles(ball.x, ball.y, 10, '#9be7ff');
        triggerShake(3, 140);
      }

      // collisions with paddles (AABB)
      function paddleCollision(p) {
        return (ball.x - ball.r < p.x + p.width &&
                ball.x + ball.r > p.x &&
                ball.y + ball.r > p.y &&
                ball.y - ball.r < p.y + p.height);
      }
      const leftP = { x: paddle.x, y: paddle.y, width: paddle.width, height: paddle.height };
      const rightP = { x: ai.x, y: ai.y, width: ai.width, height: ai.height };

      if (paddleCollision(leftP) && ball.vx < 0) {
        ball.x = leftP.x + leftP.width + ball.r + 0.5;
        const relativeY = (ball.y - (leftP.y + leftP.height / 2)) / (leftP.height / 2);
        const maxBounce = (5 * Math.PI) / 12;
        let bounceAngle = relativeY * maxBounce;
        const spin = clamp(paddle.vy / 10, -1, 1);
        bounceAngle += spin * 0.45;
        const dir = 1;
        ball.speed = Math.min(ball.speed + ball.speedIncrement, ball.maxSpeed);
        ball.vx = dir * ball.speed * Math.cos(bounceAngle);
        ball.vy = ball.speed * Math.sin(bounceAngle);
        ball.vy += paddle.vy * 0.08;
        spawnParticles(ball.x, ball.y, 22, '#dbeafe');
        playPaddleHit(Math.min(1.8, 0.7 + Math.abs(paddle.vy) / 8));
        vib(10);
        triggerShake(8, 260);
      }

      if (paddleCollision(rightP) && ball.vx > 0) {
        ball.x = rightP.x - ball.r - 0.5;
        const relativeY = (ball.y - (rightP.y + rightP.height / 2)) / (rightP.height / 2);
        const maxBounce = (5 * Math.PI) / 12;
        let bounceAngle = relativeY * maxBounce;
        const aiVy = (ball.y - (rightP.y + rightP.height / 2)) * 0.01;
        bounceAngle += clamp(aiVy, -0.4, 0.4);
        const dir = -1;
        ball.speed = Math.min(ball.speed + ball.speedIncrement * 0.6, ball.maxSpeed);
        ball.vx = dir * ball.speed * Math.cos(bounceAngle);
        ball.vy = ball.speed * Math.sin(bounceAngle);
        spawnParticles(ball.x, ball.y, 16, '#dbeafe');
        playPaddleHit(0.9);
        vib(8);
        triggerShake(6, 220);
      }

      // scores
      if (ball.x + ball.r < 0) {
        rightScore++;
        rightScoreEl.textContent = rightScore;
        playScore();
        vib([30, 20]);
        spawnParticles(80, H / 2, 50, '#ff9b9b');
        triggerShake(12, 420);
        triggerFlash(0.65);
        serveAfterDelay(false);
      } else if (ball.x - ball.r > W) {
        leftScore++;
        leftScoreEl.textContent = leftScore;
        playScore();
        vib([30, 20]);
        spawnParticles(W - 80, H / 2, 50, '#9bffce');
        triggerShake(12, 420);
        triggerFlash(0.65);
        serveAfterDelay(true);
      }
    }

    // update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04; // slight gravity
      p.vx *= 0.995;
      p.vy *= 0.995;
      p.life--;
      p.size *= 0.995;
      if (p.life <= 0 || p.size <= 0.2) particles.splice(i, 1);
    }

    // shake decay
    if (shakeTime > 0) {
      shakeTime -= 16; // approximate per-frame (rough)
      if (shakeTime < 0) shakeTime = 0;
    } else {
      shakeMag = 0;
    }
    if (shakeTime === 0) shakeMag = 0;

    // flash decay
    flashAlpha = Math.max(0, flashAlpha - 0.04);
  }

  // Render with post-processing
  function render() {
    // Draw entire scene to buffer (bctx)
    // clear buffer with slight background (so blur looks nice)
    bctx.clearRect(0, 0, W, H);

    // subtle background gradient
    const bg = bctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(255,255,255,0.02)');
    bg.addColorStop(1, 'rgba(0,0,0,0.03)');
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, W, H);

    // draw net, paddles, ball trail, ball, particles (on buffer for post-process)
    drawNet(bctx);

    // draw ball trail (fade)
    bctx.save();
    bctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ballTrail.length; i++) {
      const t = ballTrail[i];
      const alpha = (1 - i / ballTrail.length) * 0.35;
      bctx.fillStyle = `rgba(230,240,255,${alpha})`;
      bctx.beginPath();
      const sz = ball.r * (1 - i / ballTrail.length) * 1.1;
      bctx.arc(t.x, t.y, sz, 0, Math.PI * 2);
      bctx.fill();
    }
    bctx.restore();

    // paddles
    drawPaddle(bctx, paddle.x, paddle.y, paddle.width, paddle.height);
    drawPaddle(bctx, ai.x, ai.y, ai.width, ai.height);

    // ball
    drawBallTo(bctx);

    // particles (glowy)
    bctx.save();
    bctx.globalCompositeOperation = 'lighter';
    particles.forEach(p => {
      const alpha = clamp(p.life / 40, 0, 1);
      bctx.fillStyle = p.color;
      bctx.beginPath();
      bctx.globalAlpha = alpha;
      bctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      bctx.fill();
    });
    bctx.restore();

    // Now draw buffer to main canvas with effects (shake + adaptive blur + flash)
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // compute shake offset
    let sx = 0, sy = 0;
    if (shakeTime > 0 && shakeMag > 0) {
      const decay = shakeTime / Math.max(shakeTime + 1, 300);
      const mag = shakeMag * (0.6 + decay * 0.4);
      sx = (Math.random() * 2 - 1) * mag;
      sy = (Math.random() * 2 - 1) * mag * 0.6;
    }
    ctx.translate(sx, sy);

    // adaptive blur based on ball speed
    const blur = clamp((Math.abs(ball.vx) + Math.abs(ball.vy) - 5) / 5, 0, 3); // 0..3px
    // Use ctx.filter for post-process blur when supported
    try {
      ctx.filter = `blur(${blur}px)`;
    } catch (e) {
      ctx.filter = 'none';
    }

    // draw buffer
    ctx.drawImage(buffer, 0, 0);

    // reset filters for overlays
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    // screen flash overlay
    if (flashAlpha > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      ctx.fillRect(-sx, -sy, W, H);
    }

    ctx.restore();

    // HUD (pause) drawn to main canvas without blur/translate to stay stable
    if (paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(W / 2 - 120, H / 2 - 30, 240, 60);
      ctx.fillStyle = '#fff';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('En pause', W / 2, H / 2 + 8);
      ctx.restore();
    }
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // Init
  resetBall(null);
  ctx.fillStyle = '#0f1724';
  ctx.fillRect(0, 0, W, H);
  loop();

  // Input handlers
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    lastMouseY = clamp(y, 0, H);
  });
  canvas.addEventListener('mouseleave', () => lastMouseY = null);

  // Touch direct dragging
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      lastMouseY = clamp(e.touches[0].clientY - rect.top, 0, H);
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      lastMouseY = clamp(e.touches[0].clientY - rect.top, 0, H);
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => { lastMouseY = null; e.preventDefault(); }, { passive: false });

  // Virtual touch buttons
  function bindTouchButton(btn, direction) {
    const start = (e) => { e.preventDefault(); touchHold[direction] = true; if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); };
    const end = (e) => { e.preventDefault(); touchHold[direction] = false; };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchend', end, { passive: false });
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
  }
  bindTouchButton(touchUp, 'up');
  bindTouchButton(touchDown, 'down');

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; e.preventDefault(); return; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { keys[e.code] = true; canvas.focus(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { keys[e.code] = false; e.preventDefault(); } });

  canvas.addEventListener('click', () => canvas.focus());

  // Toolbar actions
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
    if (soundEnabled && !audioCtx) ensureAudio();
    if (!soundEnabled && audioCtx) { try { audioCtx.suspend && audioCtx.suspend(); } catch (e) {} }
    else if (soundEnabled && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });
  volumeInput.addEventListener('input', () => { /* createGain reads current value */ });
  resetBtn.addEventListener('click', () => {
    leftScore = 0; rightScore = 0;
    leftScoreEl.textContent = leftScore; rightScoreEl.textContent = rightScore;
    resetBall(null);
  });

  // Show/hide touch controls based on device
  function updateTouchVisibility() {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (hasTouch && window.innerWidth <= 900) touchControls.style.display = 'flex';
    else touchControls.style.display = 'none';
  }
  window.addEventListener('resize', updateTouchVisibility);
  updateTouchVisibility();

  // Expose for debug
  window._pong = { paddle, ai, ball, particles, ballTrail, triggerShake, triggerFlash };
})();
