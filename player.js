/* ============================================================
   ECLIPSE — Video.js Player Implementation
   Premium Video.js player with HLS Quality, Subtitles, and TV Series Addons
   ============================================================ */

// ============================================================
// 1. PLAYER STATE & DOM
// ============================================================
let vjsPlayer = null;
let currentStreamData = null;

const playerOverlay = document.getElementById('player-overlay');
const playerMediaTitle = document.getElementById('player-media-title');
const playerBackBtn = document.getElementById('player-back-btn');
const playerError = document.getElementById('player-error');
const playerErrorRetry = document.getElementById('player-error-retry');
const episodesPopup = document.getElementById('episodes-popup');
const episodesPopupList = document.getElementById('episodes-popup-list');

// ============================================================
// 2. VIDEO.JS CUSTOM BUTTON SETUP
// ============================================================
// Register custom buttons once
function registerVideoJsPlugins() {
  if (videojs.getComponent('ServerSwitchButton')) return; // Already registered

  // Inject Settings Popup DOM
  if (!document.getElementById('settings-popup')) {
    const settingsPopupHTML = `
      <div id="settings-popup" class="episodes-popup hidden" style="width: 260px; z-index: 2147483647; right: 60px;">
        <div class="episodes-popup-header">Settings</div>
        <div class="episodes-popup-list">
          <div class="settings-section-label">Quality</div>
          <div class="episodes-popup-item" onclick="window.openServerPickerFromSettings()">Change Server / Quality...</div>

          <div class="settings-section-label">Subtitle Size</div>
          <div class="settings-size-row" id="sub-size-row">
            <button class="settings-pill" onclick="window.setSubSize('small')">S</button>
            <button class="settings-pill active" onclick="window.setSubSize('medium')">M</button>
            <button class="settings-pill" onclick="window.setSubSize('large')">L</button>
            <button class="settings-pill" onclick="window.setSubSize('xlarge')">XL</button>
          </div>

          <div class="settings-section-label">Subtitle Color</div>
          <div class="settings-color-row" id="sub-color-row">
            <button class="settings-color-swatch active" data-color="#ffffff" onclick="window.setSubColor('#ffffff')" style="background:#ffffff;" title="White"></button>
            <button class="settings-color-swatch" data-color="#ffff00" onclick="window.setSubColor('#ffff00')" style="background:#ffff00;" title="Yellow"></button>
            <button class="settings-color-swatch" data-color="#00ff00" onclick="window.setSubColor('#00ff00')" style="background:#00ff00;" title="Green"></button>
            <button class="settings-color-swatch" data-color="#00ffff" onclick="window.setSubColor('#00ffff')" style="background:#00ffff;" title="Cyan"></button>
            <button class="settings-color-swatch" data-color="#ff69b4" onclick="window.setSubColor('#ff69b4')" style="background:#ff69b4;" title="Pink"></button>
            <button class="settings-color-swatch" data-color="#ffa500" onclick="window.setSubColor('#ffa500')" style="background:#ffa500;" title="Orange"></button>
          </div>

          <div class="settings-section-label">Subtitle Background</div>
          <div class="settings-color-row" id="sub-bg-row">
            <button class="settings-bg-swatch active" data-bg="dark" onclick="window.setSubBg('dark')" style="background:rgba(0,0,0,0.75);" title="Dark"></button>
            <button class="settings-bg-swatch" data-bg="semi" onclick="window.setSubBg('semi')" style="background:rgba(0,0,0,0.4);" title="Semi"></button>
            <button class="settings-bg-swatch" data-bg="none" onclick="window.setSubBg('none')" style="background:transparent; border: 1px dashed rgba(255,255,255,0.4);" title="None"></button>
          </div>

          <div class="settings-section-label">Playback Speed</div>
          <div class="episodes-popup-item" onclick="window.setPlaybackSpeed(0.5)">0.5x</div>
          <div class="episodes-popup-item" onclick="window.setPlaybackSpeed(1)">1x (Normal)</div>
          <div class="episodes-popup-item" onclick="window.setPlaybackSpeed(1.25)">1.25x</div>
          <div class="episodes-popup-item" onclick="window.setPlaybackSpeed(1.5)">1.5x</div>
          <div class="episodes-popup-item" onclick="window.setPlaybackSpeed(2)">2x</div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', settingsPopupHTML);
  }

  // Inject Subtitles Popup DOM
  if (!document.getElementById('subs-popup')) {
    const subsPopupHTML = `
      <div id="subs-popup" class="episodes-popup hidden" style="width: 220px; z-index: 2147483647; right: 100px;">
        <div class="episodes-popup-header">Subtitles</div>
        <div class="episodes-popup-list" id="subs-popup-container">
          <div class="episodes-popup-item" onclick="window.setSubtitle(-1)">Off</div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', subsPopupHTML);
  }

  // --- Subtitle Preferences (persisted in localStorage) ---
  const subSizeMap = { small: '0.85em', medium: '1.1em', large: '1.5em', xlarge: '2em' };
  let currentSubSize = localStorage.getItem('eclipse_sub_size') || 'medium';
  let currentSubColor = localStorage.getItem('eclipse_sub_color') || '#ffffff';
  let currentSubBg = localStorage.getItem('eclipse_sub_bg') || 'dark';
  const subBgMap = { dark: 'rgba(0,0,0,0.75)', semi: 'rgba(0,0,0,0.4)', none: 'transparent' };

  function applySubtitleStyle() {
    const el = document.querySelector('.video-js .vjs-text-track-display');
    if (el) {
      el.style.setProperty('--sub-size', subSizeMap[currentSubSize]);
      el.style.setProperty('--sub-color', currentSubColor);
      el.style.setProperty('--sub-bg', subBgMap[currentSubBg]);
    }
  }

  // Restore active states on buttons
  function syncSettingsUI() {
    document.querySelectorAll('#sub-size-row .settings-pill').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.trim() === { small: 'S', medium: 'M', large: 'L', xlarge: 'XL' }[currentSubSize]);
    });
    document.querySelectorAll('#sub-color-row .settings-color-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === currentSubColor);
    });
    document.querySelectorAll('#sub-bg-row .settings-bg-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bg === currentSubBg);
    });
  }
  syncSettingsUI();

  window.setSubSize = function(size) {
    currentSubSize = size;
    localStorage.setItem('eclipse_sub_size', size);
    applySubtitleStyle();
    syncSettingsUI();
  };

  window.setSubColor = function(color) {
    currentSubColor = color;
    localStorage.setItem('eclipse_sub_color', color);
    applySubtitleStyle();
    syncSettingsUI();
  };

  window.setSubBg = function(bg) {
    currentSubBg = bg;
    localStorage.setItem('eclipse_sub_bg', bg);
    applySubtitleStyle();
    syncSettingsUI();
  };

  window.setSubtitle = function(trackIndex) {
    if (!vjsPlayer) return;
    const tracks = vjsPlayer.textTracks();
    let captionIndex = 0;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].kind === 'captions' || tracks[i].kind === 'subtitles') {
        tracks[i].mode = captionIndex === trackIndex ? 'showing' : 'disabled';
        captionIndex++;
      }
    }
    applySubtitleStyle();
    document.getElementById('subs-popup').classList.add('hidden');
  };

  window.setPlaybackSpeed = function(rate) {
    if(vjsPlayer) vjsPlayer.playbackRate(rate);
    document.getElementById('settings-popup').classList.add('hidden');
  };

  window.openServerPickerFromSettings = function() {
    document.getElementById('settings-popup').classList.add('hidden');
    if (currentStreamData) {
      window.openSourcePicker(currentStreamData.type, currentStreamData.tmdbId, currentStreamData.season, currentStreamData.episode);
    }
  };

  // Apply subtitle style whenever tracks change
  window._applySubtitleStyle = applySubtitleStyle;

  const Button = videojs.getComponent('Button');

  // Cloud Icon: Server Switcher
  class ServerSwitchButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Switch Server');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5c0-2.64-2.05-4.78-4.65-4.96z"/></svg></span>';
    }
    buildCSSClass() {
      return `vjs-server-switch-btn ${super.buildCSSClass()}`;
    }
    handleClick() {
      if (currentStreamData) {
        window.openSourcePicker(currentStreamData.type, currentStreamData.tmdbId, currentStreamData.season, currentStreamData.episode);
      }
    }
  }
  videojs.registerComponent('ServerSwitchButton', ServerSwitchButton);

  // TV: Next Episode
  class NextEpisodeButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Next Episode');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></span>';
    }
    buildCSSClass() {
      return `vjs-next-episode-btn ${super.buildCSSClass()}`;
    }
    handleClick() {
      playNextEpisode();
    }
  }
  videojs.registerComponent('NextEpisodeButton', NextEpisodeButton);

  // TV: Episodes List
  class EpisodesListButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Episodes');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg></span>';
    }
    buildCSSClass() {
      return `vjs-episodes-list-btn ${super.buildCSSClass()}`;
    }
    handleClick() {
      const btnRect = this.el().getBoundingClientRect();
      episodesPopup.style.right = 'auto';
      let leftPos = btnRect.left + (btnRect.width / 2) - 150; // 300px width / 2
      if (leftPos < 10) leftPos = 10;
      if (leftPos + 300 > window.innerWidth - 10) leftPos = window.innerWidth - 310;
      episodesPopup.style.left = leftPos + 'px';
      
      episodesPopup.classList.toggle('hidden');
      if (!episodesPopup.classList.contains('hidden')) {
        populateEpisodesPopup();
      }
    }
  }
  videojs.registerComponent('EpisodesListButton', EpisodesListButton);

  // Skip Backward 10s
  class SkipBackwardButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Rewind 10s');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12.5 3C17.15 3 21 6.85 21 11.5C21 16.15 17.15 20 12.5 20C8.61 20 5.34 17.37 4.29 13.84L6.16 13.23C6.96 15.89 9.5 18 12.5 18C16.09 18 19 15.09 19 11.5C19 7.91 16.09 5 12.5 5C9.44 5 6.85 7.11 6.07 10H8.5L4.25 14.25L0 10H2.16C3.06 5.96 6.43 3 10.5 3H12.5Z"/></svg></span>';
    }
    handleClick() {
      const p = this.player();
      p.currentTime(Math.max(0, p.currentTime() - 10));
    }
  }
  videojs.registerComponent('SkipBackwardButton', SkipBackwardButton);

  // Skip Forward 10s
  class SkipForwardButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Forward 10s');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M11.5 3C6.85 3 3 6.85 3 11.5C3 16.15 6.85 20 11.5 20C15.39 20 18.66 17.37 19.71 13.84L17.84 13.23C17.04 15.89 14.5 18 11.5 18C7.91 18 5 15.09 5 11.5C5 7.91 7.91 5 11.5 5C14.56 5 17.15 7.11 17.93 10H15.5L19.75 14.25L24 10H21.84C20.94 5.96 17.57 3 13.5 3H11.5Z"/></svg></span>';
    }
    handleClick() {
      const p = this.player();
      if (p.duration()) {
        p.currentTime(Math.min(p.duration(), p.currentTime() + 10));
      }
    }
  }
  videojs.registerComponent('SkipForwardButton', SkipForwardButton);

  // Settings Menu (Gear Icon)
  class SettingsButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Settings');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></span>';
    }
    buildCSSClass() {
      return `vjs-settings-btn ${super.buildCSSClass()}`;
    }
    handleClick() {
      const popup = document.getElementById('settings-popup');
      if (popup) {
        const btnRect = this.el().getBoundingClientRect();
        popup.style.right = 'auto';
        let leftPos = btnRect.left + (btnRect.width / 2) - 110; // 220px width / 2
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 220 > window.innerWidth - 10) leftPos = window.innerWidth - 230;
        popup.style.left = leftPos + 'px';
        popup.classList.toggle('hidden');
      }
    }
  }
  videojs.registerComponent('SettingsButton', SettingsButton);
  // Custom Subtitles Menu (CC Icon)
  class CustomSubsButton extends Button {
    constructor(player, options) {
      super(player, options);
      this.controlText('Subtitles');
      this.el().innerHTML = '<span class="vjs-icon-placeholder" style="display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 4H5C3.89 4 3.01 4.89 3.01 6L3 20L7 16H19C20.1 16 21 15.1 21 14V6C21 4.89 20.1 4 19 4ZM7 9H9V11H7V9ZM11 9H13V11H11V9ZM15 9H17V11H15V9Z"/></svg></span>';
    }
    buildCSSClass() {
      return `vjs-custom-subs-btn ${super.buildCSSClass()}`;
    }
    handleClick() {
      const popup = document.getElementById('subs-popup');
      if (popup) {
        const btnRect = this.el().getBoundingClientRect();
        popup.style.right = 'auto';
        let leftPos = btnRect.left + (btnRect.width / 2) - 110;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 220 > window.innerWidth - 10) leftPos = window.innerWidth - 230;
        popup.style.left = leftPos + 'px';
        popup.classList.toggle('hidden');
      }
    }
  }
  videojs.registerComponent('CustomSubsButton', CustomSubsButton);

}

// ============================================================
// 3. INITIALIZATION
// ============================================================
function initPlayerIfNeeded() {
  if (vjsPlayer) return vjsPlayer;
  
  registerVideoJsPlugins();

  vjsPlayer = videojs('eclipse-videojs', {
    controls: true,
    autoplay: true,
    preload: 'auto',
    playbackRates: [0.5, 1, 1.25, 1.5, 2],
    controlBar: {
      children: [
        'playToggle',
        'SkipBackwardButton',
        'SkipForwardButton',
        'currentTimeDisplay',
        'progressControl',
        'durationDisplay',
        'customControlSpacer',
        'SettingsButton',
        'CustomSubsButton',
        'ServerSwitchButton',
        'EpisodesListButton',
        'NextEpisodeButton',
        'volumePanel',
        'pictureInPictureToggle',
        'fullscreenToggle'
      ]
    }
  });

  // Setup Plugins
  vjsPlayer.hlsQualitySelector({
      displayCurrentQuality: true,
  });

  vjsPlayer.on('error', function() {
    const err = vjsPlayer.error();
    if (err) {
      console.error('Video.js Error:', err);
      playerError.style.display = 'flex';
      playerError.classList.add('active');
    }
  });

  vjsPlayer.on('playing', function() {
    playerError.style.display = 'none';
    playerError.classList.remove('active');
  });

  // Move custom popups into the video.js container so they are visible in fullscreen
  const playerEl = vjsPlayer.el();
  const settingsPopup = document.getElementById('settings-popup');
  const subsPopup = document.getElementById('subs-popup');
  const episodesPopupEl = document.getElementById('episodes-popup');

  if (settingsPopup && settingsPopup.parentElement !== playerEl) playerEl.appendChild(settingsPopup);
  if (subsPopup && subsPopup.parentElement !== playerEl) playerEl.appendChild(subsPopup);
  if (episodesPopupEl && episodesPopupEl.parentElement !== playerEl) playerEl.appendChild(episodesPopupEl);

  return vjsPlayer;
}

// ============================================================
// 4. OPEN PLAYER
// ============================================================
window.openPlayer = function(streamData, title) {
  currentStreamData = streamData;
  playerOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Set title
  playerMediaTitle.textContent = title || '';
  
  // Hide UI overlays
  playerError.style.display = 'none';
  playerError.classList.remove('active');
  episodesPopup.classList.add('hidden');
  const settingsPopup = document.getElementById('settings-popup');
  if (settingsPopup) settingsPopup.classList.add('hidden');

  const player = initPlayerIfNeeded();

  // Show/Hide TV Specific Buttons
  const isTv = streamData.type === 'tv';
  
  // Use querySelector to find the buttons in the DOM and toggle their display
  const nextBtn = player.el().querySelector('.vjs-next-episode-btn');
  const epListBtn = player.el().querySelector('.vjs-episodes-list-btn');
  
  if (nextBtn) nextBtn.style.display = isTv ? 'flex' : 'none';
  if (epListBtn) epListBtn.style.display = isTv ? 'flex' : 'none';

  // Reset Subtitles
  const oldTracks = player.remoteTextTracks();
  let i = oldTracks.length;
  while (i--) {
    player.removeRemoteTextTrack(oldTracks[i]);
  }

  // Handle IFRAME Fallback Mode
  if (streamData.isIframe) {
    console.log('Opening iframe player:', streamData.url);
    player.el().style.display = 'none';
    
    // Remove existing iframe if any
    let oldIframe = document.getElementById('player-iframe-fallback');
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
    
    document.getElementById('player-video-wrap').appendChild(iframe);
    return;
  }

  // STANDARD VIDEO.JS MODE
  player.el().style.display = 'block';
  let oldIframe = document.getElementById('player-iframe-fallback');
  if (oldIframe) oldIframe.remove();

  if (!streamData.url) {
    playerError.classList.add('active');
    document.getElementById('player-error-text').textContent = 'No Stream';
    document.getElementById('player-error-sub').textContent = 'The server did not return a valid stream URL.';
    return;
  }

  // Load Source
  player.src({
    src: streamData.url,
    type: streamData.type === 'mp4' ? 'video/mp4' : 'application/x-mpegURL'
  });

  // Add Subtitles AFTER source is set (critical: adding before src wipes them)
  let subtitlesHtml = `<div class="episodes-popup-item" onclick="window.setSubtitle(-1)">Off</div>`;
  
  player.ready(function() {
    if (streamData.subtitles && streamData.subtitles.length > 0) {
      streamData.subtitles.forEach((sub, i) => {
        const trackEl = player.addRemoteTextTrack({
          kind: 'subtitles',
          src: sub.url,
          srclang: sub.lang_code || sub.lang || 'en',
          label: sub.label || sub.lang || `Track ${i + 1}`,
          default: false
        }, false);
        
        const label = sub.label || sub.lang || `Track ${i + 1}`;
        subtitlesHtml += `<div class="episodes-popup-item" onclick="window.setSubtitle(${i})">${label}</div>`;
      });
    }
    
    const subsContainer = document.getElementById('subs-popup-container');
    if (subsContainer) {
      subsContainer.innerHTML = subtitlesHtml;
    }
    
    // Apply saved subtitle style preferences
    if (window._applySubtitleStyle) window._applySubtitleStyle();
  });

  player.play().catch(e => console.log('Autoplay prevented:', e));
};

// ============================================================
// 5. CLOSE PLAYER
// ============================================================
window.closePlayer = function() {
  playerOverlay.classList.remove('active');
  document.body.style.overflow = '';
  episodesPopup.classList.add('hidden');

  if (vjsPlayer) {
    vjsPlayer.pause();
    vjsPlayer.src(''); // Clear source
  }

  // Exit fullscreen
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  
  currentStreamData = null;
};

playerBackBtn.addEventListener('click', window.closePlayer);

playerErrorRetry.addEventListener('click', () => {
  if (currentStreamData) {
    window.openSourcePicker(currentStreamData.type, currentStreamData.tmdbId, currentStreamData.season, currentStreamData.episode);
  }
});

// Hide episode popup when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.episodes-popup') && !e.target.closest('.vjs-episodes-list-btn') && !e.target.closest('.vjs-settings-btn') && !e.target.closest('.vjs-custom-subs-btn')) {
    episodesPopup.classList.add('hidden');
    const settingsPopup = document.getElementById('settings-popup');
    if (settingsPopup) settingsPopup.classList.add('hidden');
    const subsPopup = document.getElementById('subs-popup');
    if (subsPopup) subsPopup.classList.add('hidden');
  }
});

// ============================================================
// 6. TV SERIES LOGIC
// ============================================================
async function populateEpisodesPopup() {
  if (!currentStreamData || currentStreamData.type !== 'tv') return;
  
  episodesPopupList.innerHTML = '<div style="padding: 10px; color: #fff;">Loading...</div>';
  
  try {
    const seasonData = await getSeasonDetails(currentStreamData.tmdbId, currentStreamData.season);
    if (!seasonData.episodes || seasonData.episodes.length === 0) {
      episodesPopupList.innerHTML = '<div style="padding: 10px; color: #fff;">No episodes found.</div>';
      return;
    }

    episodesPopupList.innerHTML = seasonData.episodes.map(ep => `
      <div class="episodes-popup-item ${ep.episode_number === currentStreamData.episode ? 'active' : ''}" 
           onclick="playMedia('tv', ${currentStreamData.tmdbId}, ${currentStreamData.season}, ${ep.episode_number})">
        <div class="ep-num">${ep.episode_number}</div>
        <div class="ep-info">
          <div class="ep-title">${ep.name || `Episode ${ep.episode_number}`}</div>
        </div>
      </div>
    `).join('');
    
    // Scroll to active episode
    setTimeout(() => {
      const activeEl = episodesPopupList.querySelector('.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

  } catch (err) {
    console.error('Failed to load season details for popup:', err);
    episodesPopupList.innerHTML = '<div style="padding: 10px; color: #fff;">Failed to load.</div>';
  }
}

async function playNextEpisode() {
  if (!currentStreamData || currentStreamData.type !== 'tv') return;
  
  try {
    const seasonData = await getSeasonDetails(currentStreamData.tmdbId, currentStreamData.season);
    const nextEp = currentStreamData.episode + 1;
    
    // Check if next episode exists in current season
    const exists = seasonData.episodes.find(e => e.episode_number === nextEp);
    if (exists) {
      playMedia('tv', currentStreamData.tmdbId, currentStreamData.season, nextEp);
    } else {
      // Try next season episode 1
      playMedia('tv', currentStreamData.tmdbId, currentStreamData.season + 1, 1);
    }
  } catch (err) {
    console.error('Failed to skip to next episode:', err);
    alert('Could not load next episode.');
  }
}

// ============================================================
// 7. KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', function(e) {
  const overlay = document.getElementById('player-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  
  // Ignore if typing in an input (e.g., search bar if somehow focused)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const p = vjsPlayer;
  if (!p) return;

  switch(e.key.toLowerCase()) {
    case ' ': // Space: Play/Pause
      e.preventDefault();
      if (p.paused()) p.play();
      else p.pause();
      break;
    case 'arrowleft': // Left Arrow: Skip backward 10s
      e.preventDefault();
      p.currentTime(Math.max(0, p.currentTime() - 10));
      break;
    case 'arrowright': // Right Arrow: Skip forward 10s
      e.preventDefault();
      p.currentTime(Math.min(p.duration() || 0, p.currentTime() + 10));
      break;
    case 'arrowup': // Up Arrow: Volume up
      e.preventDefault();
      p.volume(Math.min(1, p.volume() + 0.1));
      break;
    case 'arrowdown': // Down Arrow: Volume down
      e.preventDefault();
      p.volume(Math.max(0, p.volume() - 0.1));
      break;
    case 'm': // M: Mute/Unmute
      e.preventDefault();
      p.muted(!p.muted());
      break;
    case 'f': // F: Toggle Fullscreen
      e.preventDefault();
      if (p.isFullscreen()) p.exitFullscreen();
      else p.requestFullscreen();
      break;
  }
});
