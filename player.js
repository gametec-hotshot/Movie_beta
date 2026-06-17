/* ============================================================
   ECLIPSE — Custom Video Player
   Premium HLS player with glassmorphic controls
   ============================================================ */

// ============================================================
// 1. PLAYER STATE
// ============================================================
let playerHls = null;
let controlsTimeout = null;
let isSeeking = false;
let currentQualityLevel = -1; // -1 = auto
let currentSubTrack = -1; // -1 = off
let currentStreamData = null;

// ============================================================
// 2. DOM REFERENCES
// ============================================================
const playerOverlay = document.getElementById('player-overlay');
const playerVideo = document.getElementById('player-video');
const playerTopBar = document.getElementById('player-top-bar');
const playerControls = document.getElementById('player-controls');
const playerPlayBtn = document.getElementById('player-play-btn');
const playerProgressWrap = document.getElementById('player-progress-wrap');
const playerProgressFilled = document.getElementById('player-progress-filled');
const playerProgressBuffer = document.getElementById('player-progress-buffer');
const playerProgressThumb = document.getElementById('player-progress-thumb');
const playerTime = document.getElementById('player-time');
const playerVolBtn = document.getElementById('player-vol-btn');
const playerVolSlider = document.getElementById('player-vol-slider');
const playerFsBtn = document.getElementById('player-fs-btn');
const playerPipBtn = document.getElementById('player-pip-btn');
const playerQualityBtn = document.getElementById('player-quality-btn');
const playerSubsBtn = document.getElementById('player-subs-btn');
const playerRwBtn = document.getElementById('player-rw-btn');
const playerFfBtn = document.getElementById('player-ff-btn');
const playerBackBtn = document.getElementById('player-back-btn');
const playerLoading = document.getElementById('player-loading');
const playerLoadingText = document.getElementById('player-loading-text');
const playerError = document.getElementById('player-error');
const playerErrorRetry = document.getElementById('player-error-retry');
const qualityMenu = document.getElementById('quality-menu');
const qualityMenuItems = document.getElementById('quality-menu-items');
const subsMenu = document.getElementById('subs-menu');
const subsMenuItems = document.getElementById('subs-menu-items');
const playerMediaTitle = document.getElementById('player-media-title');

// ============================================================
// 3. OPEN PLAYER
// ============================================================
function openPlayer(streamData, title) {
  currentStreamData = streamData;
  playerOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Set title
  playerMediaTitle.textContent = title || '';

  // Reset state
  playerError.classList.remove('active');
  playerLoading.style.display = 'flex';
  playerLoadingText.textContent = 'Connecting to server...';
  playerPlayBtn.textContent = '▶';
  playerProgressFilled.style.width = '0%';
  playerProgressBuffer.style.width = '0%';
  playerTime.textContent = '0:00 / 0:00';
  qualityMenu.classList.remove('active');
  subsMenu.classList.remove('active');

  // Handle IFRAME fallback mode
  if (streamData.isIframe) {
    console.log('Opening iframe player:', streamData.url);
    
    // Hide our custom controls
    playerVideo.style.display = 'none';
    playerControls.style.display = 'none';
    playerTopBar.classList.remove('hidden'); // Keep top bar for the Close button
    
    // Remove existing iframe if any
    const oldIframe = document.getElementById('player-iframe-fallback');
    if (oldIframe) oldIframe.remove();

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'player-iframe-fallback';
    iframe.src = streamData.url;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.zIndex = '5';
    iframe.allowFullscreen = true;
    
    iframe.onload = () => {
      playerLoading.style.display = 'none';
    };

    document.getElementById('player-video-wrap').appendChild(iframe);
    return;
  }

  // STANDARD HLS MODE
  playerVideo.style.display = 'block';
  playerControls.style.display = 'flex';
  const oldIframe = document.getElementById('player-iframe-fallback');
  if (oldIframe) oldIframe.remove();

  const streamUrl = streamData.url;
  const referer = streamData.referer || '';

  if (!streamUrl) {
    showPlayerError('No Stream', 'The server did not return a valid stream URL.');
    return;
  }

  console.log('Opening player with stream:', streamUrl);

  if (playerHls) {
    playerHls.destroy();
    playerHls = null;
  }

  // Remove any old text tracks
  while (playerVideo.firstChild) {
    playerVideo.removeChild(playerVideo.firstChild);
  }

  if (streamData.type === 'mp4') {
    // Native MP4 playback
    playerVideo.src = streamUrl;
    playerLoading.style.display = 'none';
    playerVideo.play().catch(() => {});
    showControls();
    
    // Default quality menu for MP4
    subsMenuItems.innerHTML = '<div class="player-menu-item active" data-track="-1">Off <span class="check">✓</span></div>';
    qualityMenuItems.innerHTML = `<div class="player-menu-item active">Auto <span class="check">✓</span></div>`;
    
  } else if (Hls.isSupported()) {
    playerHls = new Hls({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      startLevel: -1, // auto
      capLevelToPlayerSize: true,
      enableWorker: true,
      lowLatencyMode: false,
      // Robustness for slow proxies:
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 5,
      levelLoadingTimeOut: 20000,
      levelLoadingMaxRetry: 5,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 5,
    });

    playerHls.loadSource(streamUrl);
    playerHls.attachMedia(playerVideo);

    playerHls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      playerLoading.style.display = 'none';
      playerVideo.play().catch(() => {});
      buildQualityMenu(data.levels);
      showControls();
    });

    playerHls.on(Hls.Events.ERROR, (event, data) => {
      console.error('HLS Error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (data.details === 'manifestParsingError') {
              showPlayerError('Broken Source', 'This provider returned an invalid stream. Please click the Settings gear to try another source.');
            } else {
              console.log('Network error, retrying...');
              playerHls.startLoad();
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Media error, recovering...');
            playerHls.recoverMediaError();
            break;
          default:
            showPlayerError('Stream Error', 'This server returned an invalid stream. Try another server.');
            break;
        }
      }
    });

    playerHls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      updateQualityIndicator(data.level);
    });

  } else if (playerVideo.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    playerVideo.src = streamUrl;
    playerVideo.addEventListener('loadedmetadata', () => {
      playerLoading.style.display = 'none';
      playerVideo.play().catch(() => {});
      showControls();
    }, { once: true });
  } else {
    showPlayerError('Unsupported Browser', 'Your browser does not support HLS playback.');
  }

  // Load subtitles if available
  if (streamData.subtitles && streamData.subtitles.length > 0) {
    loadSubtitles(streamData.subtitles);
  } else {
    subsMenuItems.innerHTML = '<div class="player-menu-item active" data-track="-1">Off <span class="check">✓</span></div>';
  }
}

// ============================================================
// 4. CLOSE PLAYER
// ============================================================
function closePlayer() {
  playerOverlay.classList.remove('active');
  document.body.style.overflow = '';

  if (playerHls) {
    playerHls.destroy();
    playerHls = null;
  }

  playerVideo.pause();
  playerVideo.removeAttribute('src');
  playerVideo.load();

  // Exit fullscreen
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  clearTimeout(controlsTimeout);
  currentStreamData = null;
}

playerBackBtn.addEventListener('click', closePlayer);
playerErrorRetry.addEventListener('click', () => {
  closePlayer();
  // Open the source picker directly so they can choose a different one
  document.getElementById('server-modal-overlay').classList.add('active');
});

// ============================================================
// 5. PLAY / PAUSE
// ============================================================
function togglePlay() {
  if (playerVideo.paused) {
    playerVideo.play().catch(() => {});
  } else {
    playerVideo.pause();
  }
}

playerPlayBtn.addEventListener('click', togglePlay);

playerVideo.addEventListener('click', e => {
  // On mobile, first click shows controls, second toggles play
  if (window.innerWidth < 768) {
    if (playerControls.classList.contains('hidden')) {
      showControls();
      return;
    }
  }
  togglePlay();
});

playerVideo.addEventListener('play', () => {
  playerPlayBtn.textContent = '⏸';
  playerLoading.style.display = 'none';
});

playerVideo.addEventListener('pause', () => {
  playerPlayBtn.textContent = '▶';
  showControls();
});

playerVideo.addEventListener('waiting', () => {
  playerLoading.style.display = 'flex';
  playerLoadingText.textContent = 'Buffering...';
});

playerVideo.addEventListener('playing', () => {
  playerLoading.style.display = 'none';
});

// ============================================================
// 6. PROGRESS BAR
// ============================================================
playerVideo.addEventListener('timeupdate', () => {
  if (isSeeking || !playerVideo.duration) return;

  const pct = (playerVideo.currentTime / playerVideo.duration) * 100;
  playerProgressFilled.style.width = `${pct}%`;
  playerProgressThumb.style.left = `${pct}%`;
  playerTime.textContent = `${formatTime(playerVideo.currentTime)} / ${formatTime(playerVideo.duration)}`;
});

playerVideo.addEventListener('progress', () => {
  if (!playerVideo.duration || !playerVideo.buffered.length) return;
  const bufferedEnd = playerVideo.buffered.end(playerVideo.buffered.length - 1);
  const bufferPct = (bufferedEnd / playerVideo.duration) * 100;
  playerProgressBuffer.style.width = `${bufferPct}%`;
});

// Seek
playerProgressWrap.addEventListener('mousedown', startSeek);
playerProgressWrap.addEventListener('touchstart', startSeek, { passive: true });

function startSeek(e) {
  isSeeking = true;
  seek(e);
  document.addEventListener('mousemove', seek);
  document.addEventListener('touchmove', seek, { passive: true });
  document.addEventListener('mouseup', endSeek);
  document.addEventListener('touchend', endSeek);
}

function seek(e) {
  const rect = playerProgressWrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  playerProgressFilled.style.width = `${pct * 100}%`;
  playerProgressThumb.style.left = `${pct * 100}%`;

  if (playerVideo.duration) {
    playerTime.textContent = `${formatTime(pct * playerVideo.duration)} / ${formatTime(playerVideo.duration)}`;
  }
}

function endSeek(e) {
  const rect = playerProgressWrap.getBoundingClientRect();
  const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));

  if (playerVideo.duration) {
    playerVideo.currentTime = pct * playerVideo.duration;
  }

  isSeeking = false;
  document.removeEventListener('mousemove', seek);
  document.removeEventListener('touchmove', seek);
  document.removeEventListener('mouseup', endSeek);
  document.removeEventListener('touchend', endSeek);
}

// ============================================================
// 7. VOLUME
// ============================================================
playerVolBtn.addEventListener('click', () => {
  playerVideo.muted = !playerVideo.muted;
  updateVolumeIcon();
});

playerVolSlider.addEventListener('input', () => {
  playerVideo.volume = parseFloat(playerVolSlider.value);
  playerVideo.muted = playerVideo.volume === 0;
  updateVolumeIcon();
});

function updateVolumeIcon() {
  if (playerVideo.muted || playerVideo.volume === 0) {
    playerVolBtn.textContent = '🔇';
    playerVolSlider.value = 0;
  } else if (playerVideo.volume < 0.5) {
    playerVolBtn.textContent = '🔉';
    playerVolSlider.value = playerVideo.volume;
  } else {
    playerVolBtn.textContent = '🔊';
    playerVolSlider.value = playerVideo.volume;
  }
}

// ============================================================
// 8. SKIP FORWARD / REWIND
// ============================================================
playerRwBtn.addEventListener('click', () => {
  playerVideo.currentTime = Math.max(0, playerVideo.currentTime - 10);
  showControls();
});

playerFfBtn.addEventListener('click', () => {
  if (playerVideo.duration) {
    playerVideo.currentTime = Math.min(playerVideo.duration, playerVideo.currentTime + 10);
  }
  showControls();
});

// ============================================================
// 9. FULLSCREEN
// ============================================================
playerFsBtn.addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    playerOverlay.requestFullscreen().catch(() => {
      // iOS fallback
      if (playerVideo.webkitEnterFullscreen) {
        playerVideo.webkitEnterFullscreen();
      }
    });
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener('fullscreenchange', () => {
  playerFsBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
});

// ============================================================
// 10. PICTURE IN PICTURE
// ============================================================
playerPipBtn.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (playerVideo.requestPictureInPicture) {
      await playerVideo.requestPictureInPicture();
    }
  } catch (err) {
    console.error('PiP error:', err);
  }
});

// ============================================================
// 11. QUALITY MENU
// ============================================================
playerQualityBtn.addEventListener('click', e => {
  e.stopPropagation();
  subsMenu.classList.remove('active');
  qualityMenu.classList.toggle('active');
});

function buildQualityMenu(levels) {
  if (!levels || levels.length === 0) {
    qualityMenuItems.innerHTML = '<div class="player-menu-item active" data-level="-1">Auto <span class="check">✓</span></div>';
    return;
  }

  let html = '<div class="player-menu-item active" data-level="-1" onclick="setQuality(-1)">Auto <span class="check">✓</span></div>';

  // Sort by height descending
  const sorted = levels.map((l, i) => ({ ...l, index: i })).sort((a, b) => b.height - a.height);
  const seen = new Set();

  sorted.forEach(level => {
    const label = `${level.height}p`;
    if (seen.has(level.height)) return;
    seen.add(level.height);
    html += `<div class="player-menu-item" data-level="${level.index}" onclick="setQuality(${level.index})">${label} <span class="check">✓</span></div>`;
  });

  qualityMenuItems.innerHTML = html;
}

window.setQuality = function (level) {
  if (!playerHls) return;
  currentQualityLevel = level;
  playerHls.currentLevel = level;
  qualityMenuItems.querySelectorAll('.player-menu-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.level) === level);
  });
  qualityMenu.classList.remove('active');
};

function updateQualityIndicator(levelIndex) {
  if (!playerHls || !playerHls.levels || !playerHls.levels[levelIndex]) return;
  const height = playerHls.levels[levelIndex].height;
  playerQualityBtn.textContent = height >= 1080 ? 'HD' : height >= 720 ? 'HD' : 'SD';
}

// ============================================================
// 12. SUBTITLES
// ============================================================
playerSubsBtn.addEventListener('click', e => {
  e.stopPropagation();
  qualityMenu.classList.remove('active');
  subsMenu.classList.toggle('active');
});

function loadSubtitles(subtitles) {
  let html = '<div class="player-menu-item active" data-track="-1" onclick="setSubtitle(-1)">Off <span class="check">✓</span></div>';

  subtitles.forEach((sub, i) => {
    html += `<div class="player-menu-item" data-track="${i}" onclick="setSubtitle(${i})">${sub.lang || sub.label || `Track ${i + 1}`} <span class="check">✓</span></div>`;

    // Add track to video element
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.lang || sub.label || `Track ${i + 1}`;
    track.src = sub.url;
    track.srclang = sub.lang_code || 'en';
    playerVideo.appendChild(track);
  });

  subsMenuItems.innerHTML = html;
}

window.setSubtitle = function (index) {
  currentSubTrack = index;
  const tracks = playerVideo.textTracks;

  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = i === index ? 'showing' : 'hidden';
  }

  subsMenuItems.querySelectorAll('.player-menu-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.track) === index);
  });

  subsMenu.classList.remove('active');
};

// ============================================================
// 13. CONTROLS VISIBILITY
// ============================================================
function showControls() {
  playerControls.classList.remove('hidden');
  playerTopBar.classList.remove('hidden');
  clearTimeout(controlsTimeout);

  if (!playerVideo.paused) {
    controlsTimeout = setTimeout(hideControls, 3000);
  }
}

function hideControls() {
  if (playerVideo.paused) return;
  if (qualityMenu.classList.contains('active') || subsMenu.classList.contains('active')) return;
  playerControls.classList.add('hidden');
  playerTopBar.classList.add('hidden');
}

// Mouse/touch movement shows controls
document.getElementById('player-video-wrap').addEventListener('mousemove', showControls);
document.getElementById('player-video-wrap').addEventListener('touchstart', () => {
  if (playerControls.classList.contains('hidden')) {
    showControls();
  }
}, { passive: true });

playerControls.addEventListener('mouseenter', () => clearTimeout(controlsTimeout));
playerControls.addEventListener('mouseleave', () => {
  if (!playerVideo.paused) controlsTimeout = setTimeout(hideControls, 3000);
});

// Close menus on click outside
document.addEventListener('click', e => {
  if (!e.target.closest('#quality-menu') && !e.target.closest('#player-quality-btn')) {
    qualityMenu.classList.remove('active');
  }
  if (!e.target.closest('#subs-menu') && !e.target.closest('#player-subs-btn')) {
    subsMenu.classList.remove('active');
  }
});

// ============================================================
// 14. KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  if (!playerOverlay.classList.contains('active')) return;
  if (e.target.tagName === 'INPUT') return;

  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      playerVideo.currentTime = Math.max(0, playerVideo.currentTime - 10);
      showControls();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (playerVideo.duration) playerVideo.currentTime = Math.min(playerVideo.duration, playerVideo.currentTime + 10);
      showControls();
      break;
    case 'ArrowUp':
      e.preventDefault();
      playerVideo.volume = Math.min(1, playerVideo.volume + 0.1);
      playerVideo.muted = false;
      updateVolumeIcon();
      showControls();
      break;
    case 'ArrowDown':
      e.preventDefault();
      playerVideo.volume = Math.max(0, playerVideo.volume - 0.1);
      updateVolumeIcon();
      showControls();
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'm':
    case 'M':
      e.preventDefault();
      playerVideo.muted = !playerVideo.muted;
      updateVolumeIcon();
      showControls();
      break;
    case 'Escape':
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        closePlayer();
      }
      break;
  }
});

// ============================================================
// 15. DOUBLE TAP TO SEEK (Mobile)
// ============================================================
let lastTapTime = 0;
let lastTapX = 0;

document.getElementById('player-video-wrap').addEventListener('touchend', e => {
  const now = Date.now();
  const tapX = e.changedTouches[0].clientX;

  if (now - lastTapTime < 300) {
    // Double tap
    const wrapWidth = document.getElementById('player-video-wrap').offsetWidth;
    if (tapX < wrapWidth / 3) {
      // Left third — rewind
      playerVideo.currentTime = Math.max(0, playerVideo.currentTime - 10);
      showSkipIndicator('left', '-10s');
    } else if (tapX > (wrapWidth * 2) / 3) {
      // Right third — forward
      if (playerVideo.duration) {
        playerVideo.currentTime = Math.min(playerVideo.duration, playerVideo.currentTime + 10);
      }
      showSkipIndicator('right', '+10s');
    } else {
      // Center — toggle play
      togglePlay();
    }
    e.preventDefault();
  }

  lastTapTime = now;
  lastTapX = tapX;
});

function showSkipIndicator(side, text) {
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: absolute;
    ${side}: 20%;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255,255,255,0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 50%;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 600;
    color: white;
    z-index: 20;
    pointer-events: none;
    animation: skipFade 0.6s ease-out forwards;
  `;
  indicator.textContent = text;

  const style = document.createElement('style');
  style.textContent = `@keyframes skipFade { 0% { opacity: 1; transform: translateY(-50%) scale(1); } 100% { opacity: 0; transform: translateY(-50%) scale(1.5); } }`;
  indicator.appendChild(style);

  document.getElementById('player-video-wrap').appendChild(indicator);
  setTimeout(() => indicator.remove(), 600);
}

// ============================================================
// 16. ERROR DISPLAY
// ============================================================
function showPlayerError(title, message) {
  playerLoading.style.display = 'none';
  document.getElementById('player-error-text').textContent = title;
  document.getElementById('player-error-sub').textContent = message;
  playerError.classList.add('active');
}

// ============================================================
// 17. HELPERS
// ============================================================
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
