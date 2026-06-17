/* ============================================================
   ECLIPSE — Application Core
   TMDB integration, CinePro streaming backend, SPA router
   ============================================================ */

// ============================================================
// 1. CONFIGURATION
// ============================================================
const TMDB_API_KEY = '672e5e4c75045836d95e09aadef1e3f3';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_W500 = 'https://image.tmdb.org/t/p/w500';
const IMG_ORIGINAL = 'https://image.tmdb.org/t/p/original';
const IMG_W1280 = 'https://image.tmdb.org/t/p/w1280';
const IMG_W185 = 'https://image.tmdb.org/t/p/w185';
const IMG_W300 = 'https://image.tmdb.org/t/p/w300';

// CinePro Core Backend URL (Render deployment)
// Update this after deploying CinePro Core to Render
const CINEPRO_API = localStorage.getItem('eclipse_cinepro_url') || 'https://eclipse-api-q48h.onrender.com';

// ============================================================
// 2. KEEP-ALIVE PING (Render free tier anti-spin-down)
// ============================================================
let keepAliveInterval = null;

function startKeepAlive() {
  // Ping CinePro Core every 13 minutes to prevent Render's 15-min idle shutdown
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(async () => {
    try {
      await fetch(`${CINEPRO_API}/v1`, { method: 'GET', mode: 'cors' });
      console.log('[KeepAlive] Pinged CinePro Core');
    } catch (e) {
      // Silently ignore — user might be offline
    }
  }, 13 * 60 * 1000); // 13 minutes
}

// Also do an initial warm-up ping on page load
async function warmUpBackend() {
  try {
    const res = await fetch(`${CINEPRO_API}/v1`, { method: 'GET', mode: 'cors' });
    if (res.ok) {
      console.log('[Eclipse] CinePro Core is online');
    }
  } catch (e) {
    console.warn('[Eclipse] CinePro Core may be starting up (cold start)...');
  }
}

// ============================================================
// 3. STATE
// ============================================================
let currentView = 'home';
let currentDetailsData = null;
let currentDetailsType = null;
let currentDetailsId = null;
let heroData = null;
let searchTimeout = null;
let moviePage = 1;
let tvPage = 1;
let movieGenreId = null;
let tvGenreId = null;
let isLoadingMore = false;
let lastFetchedSources = null; // Cache last CinePro response

// ============================================================
// 4. DOM REFERENCES
// ============================================================
const $ = id => document.getElementById(id);
const navbar = $('navbar');
const searchInput = $('search-input');
const searchBtn = $('search-btn');
const navSearch = $('nav-search');
const rowsContainer = $('rows-container');

// ============================================================
// 5. TMDB API
// ============================================================
async function tmdbFetch(path) {
  const separator = path.includes('?') ? '&' : '?';
  const res = await fetch(`${TMDB_BASE}${path}${separator}api_key=${TMDB_API_KEY}`);
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json();
}

async function getTrending(type = 'all', timeWindow = 'week') {
  return tmdbFetch(`/trending/${type}/${timeWindow}`);
}

async function getPopular(type = 'movie', page = 1) {
  return tmdbFetch(`/${type}/popular?page=${page}`);
}

async function getTopRated(type = 'movie', page = 1) {
  return tmdbFetch(`/${type}/top_rated?page=${page}`);
}

async function searchMulti(query, page = 1) {
  return tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&page=${page}`);
}

async function getDetails(type, id) {
  return tmdbFetch(`/${type}/${id}?append_to_response=credits,similar,external_ids`);
}

async function getSeasonDetails(tvId, seasonNumber) {
  return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);
}

async function getGenres(type = 'movie') {
  return tmdbFetch(`/genre/${type}/list`);
}

async function discoverByGenre(type = 'movie', genreId, page = 1) {
  return tmdbFetch(`/discover/${type}?with_genres=${genreId}&sort_by=popularity.desc&page=${page}`);
}

// ============================================================
// 6. CINEPRO CORE API — Stream Fetching
// ============================================================
async function fetchStreamSources(type, tmdbId, season = null, episode = null) {
  let url;
  if (type === 'tv' && season != null && episode != null) {
    url = `${CINEPRO_API}/v1/tv/${tmdbId}/seasons/${season}/episodes/${episode}`;
  } else {
    url = `${CINEPRO_API}/v1/movies/${tmdbId}`;
  }

  console.log('[CinePro] Fetching sources:', url);

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    mode: 'cors'
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `HTTP ${res.status}`;
    throw new Error(errorMsg);
  }

  const data = await res.json();
  console.log('[CinePro] Response:', data);

  // Transform CinePro OMSS response into our internal format
  return transformCineProResponse(data);
}

function transformCineProResponse(data) {
  const sources = (data.sources || []).map(src => ({
    url: src.url.startsWith('/') ? `${CINEPRO_API}${src.url}` : src.url,
    type: src.type || 'hls',
    quality: src.quality || 'unknown',
    provider: src.provider?.name || 'Unknown',
    providerId: src.provider?.id || 'unknown',
    audioTracks: src.audioTracks || [],
  }));

  const subtitles = (data.subtitles || []).map(sub => ({
    url: sub.url.startsWith('/') ? `${CINEPRO_API}${sub.url}` : sub.url,
    label: sub.label || 'Unknown',
    lang: sub.label || 'en',
    format: sub.format || 'vtt',
  }));

  return {
    responseId: data.responseId,
    expiresAt: data.expiresAt,
    sources,
    subtitles,
    diagnostics: data.diagnostics || [],
  };
}

// Quality ranking for sorting sources
function qualityRank(quality) {
  if (!quality) return 1;
  const q = quality.toLowerCase();
  if (q.includes('2160') || q.includes('4k')) return 6;
  if (q.includes('1080')) return 5;
  if (q.includes('720')) return 4;
  if (q.includes('480')) return 3;
  if (q.includes('360')) return 2;
  return 1;
}

function getBestSource(sources) {
  if (!sources || sources.length === 0) return null;
  // Sort by quality (highest first), prefer HLS
  return [...sources].sort((a, b) => {
    const qDiff = qualityRank(b.quality) - qualityRank(a.quality);
    if (qDiff !== 0) return qDiff;
    // Prefer HLS over raw MP4
    if (a.type === 'hls' && b.type !== 'hls') return -1;
    if (b.type === 'hls' && a.type !== 'hls') return 1;
    return 0;
  })[0];
}

// ============================================================
// 7. UI RENDERING — CARDS
// ============================================================
function createCardHTML(item) {
  const title = item.title || item.name || 'Unknown';
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const poster = item.poster_path ? `${IMG_W500}${item.poster_path}` : '';
  const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');

  return `
    <div class="card" data-id="${item.id}" data-type="${type}" onclick="openDetails('${type}', ${item.id})">
      <div class="card-poster ${!poster ? 'loading' : ''}">
        ${poster ? `<img src="${poster}" alt="${title}" loading="lazy" onerror="this.parentElement.classList.add('loading'); this.style.display='none';">` : ''}
        ${rating ? `<div class="card-rating">★ ${rating}</div>` : ''}
        <div class="card-play-icon">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title">${title}</div>
      <div class="card-year">${year}</div>
    </div>
  `;
}

function createContentRow(title, items, id) {
  if (!items || items.length === 0) return '';
  return `
    <div class="content-section slide-up">
      <div class="section-header">
        <h2 class="section-title">${title}</h2>
      </div>
      <div class="content-row" id="${id}">
        ${items.map(createCardHTML).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// 8. HOME VIEW
// ============================================================
async function loadHome() {
  try {
    const [trending, popularMovies, topRated, popularTV] = await Promise.all([
      getTrending('all', 'week'),
      getPopular('movie'),
      getTopRated('movie'),
      getPopular('tv')
    ]);

    // Hero — use first trending item
    if (trending.results.length > 0) {
      const hero = trending.results[0];
      heroData = hero;
      const heroType = hero.media_type || 'movie';

      const backdrop = $('hero-backdrop');
      if (hero.backdrop_path) {
        backdrop.style.backgroundImage = `url(${IMG_ORIGINAL}${hero.backdrop_path})`;
      }

      $('hero-title').textContent = hero.title || hero.name;

      const rating = hero.vote_average ? `<span class="rating">★ ${hero.vote_average.toFixed(1)}</span>` : '';
      const year = (hero.release_date || hero.first_air_date || '').substring(0, 4);
      const type = heroType === 'tv' ? 'TV Show' : 'Movie';
      $('hero-meta').innerHTML = `
        ${rating}
        ${rating && year ? '<span class="separator"></span>' : ''}
        ${year ? `<span>${year}</span>` : ''}
        <span class="separator"></span>
        <span>${type}</span>
      `;

      $('hero-overview').textContent = hero.overview || '';

      $('hero-play-btn').onclick = () => playMedia(heroType, hero.id);
      $('hero-details-btn').onclick = () => openDetails(heroType, hero.id);
    }

    // Content rows
    rowsContainer.innerHTML = [
      createContentRow('Trending This Week', trending.results.slice(1), 'row-trending'),
      createContentRow('Popular Movies', popularMovies.results, 'row-popular-movies'),
      createContentRow('Top Rated', topRated.results, 'row-top-rated'),
      createContentRow('Popular TV Shows', popularTV.results.map(i => ({ ...i, media_type: 'tv' })), 'row-popular-tv'),
    ].join('');
  } catch (err) {
    console.error('Failed to load home:', err);
    rowsContainer.innerHTML = `<p style="text-align:center; color: var(--text-tertiary); padding: 100px 20px;">Failed to load content. Please check your connection.</p>`;
  }
}

// ============================================================
// 9. MOVIES / TV CATEGORY VIEWS
// ============================================================
async function loadCategoryView(type) {
  const gridId = type === 'movie' ? 'movies-grid' : 'tv-grid';
  const filterId = type === 'movie' ? 'movie-genre-filter' : 'tv-genre-filter';
  const loadMoreBtnId = type === 'movie' ? 'movies-load-more-btn' : 'tv-load-more-btn';
  const page = type === 'movie' ? moviePage : tvPage;
  const genreId = type === 'movie' ? movieGenreId : tvGenreId;

  try {
    // Load genres
    const genreBar = $(filterId);
    if (genreBar.children.length === 0) {
      const genres = await getGenres(type);
      genreBar.innerHTML = `<button class="genre-filter-btn active" data-genre="">All</button>` +
        genres.genres.map(g => `<button class="genre-filter-btn" data-genre="${g.id}">${g.name}</button>`).join('');

      genreBar.addEventListener('click', e => {
        if (e.target.classList.contains('genre-filter-btn')) {
          genreBar.querySelectorAll('.genre-filter-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          const gid = e.target.dataset.genre || null;
          if (type === 'movie') { movieGenreId = gid; moviePage = 1; }
          else { tvGenreId = gid; tvPage = 1; }
          $(gridId).innerHTML = '';
          loadCategoryPage(type, 1);
        }
      });
    }

    await loadCategoryPage(type, page);
  } catch (err) {
    console.error(`Failed to load ${type}:`, err);
  }
}

async function loadCategoryPage(type, page) {
  const gridId = type === 'movie' ? 'movies-grid' : 'tv-grid';
  const loadMoreBtnId = type === 'movie' ? 'movies-load-more-btn' : 'tv-load-more-btn';
  const genreId = type === 'movie' ? movieGenreId : tvGenreId;

  isLoadingMore = true;
  try {
    let data;
    if (genreId) {
      data = await discoverByGenre(type, genreId, page);
    } else {
      data = await getPopular(type, page);
    }

    const grid = $(gridId);
    const items = data.results.map(i => ({ ...i, media_type: type }));
    grid.innerHTML += items.map(createCardHTML).join('');

    const loadMoreBtn = $(loadMoreBtnId);
    if (data.page < data.total_pages) {
      loadMoreBtn.style.display = 'inline-flex';
      loadMoreBtn.onclick = () => {
        if (type === 'movie') moviePage++;
        else tvPage++;
        loadCategoryPage(type, type === 'movie' ? moviePage : tvPage);
      };
    } else {
      loadMoreBtn.style.display = 'none';
    }
  } catch (err) {
    console.error(`Failed to load ${type} page ${page}:`, err);
  }
  isLoadingMore = false;
}

// ============================================================
// 10. SEARCH
// ============================================================
async function performSearch(query) {
  if (!query || query.trim().length < 2) return;

  $('search-query-display').textContent = query;
  const grid = $('search-grid');
  const empty = $('search-empty');
  grid.innerHTML = '';
  empty.classList.add('hidden');

  try {
    const data = await searchMulti(query);
    const results = data.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv');

    if (results.length === 0) {
      empty.classList.remove('hidden');
    } else {
      grid.innerHTML = results.map(createCardHTML).join('');
    }
  } catch (err) {
    console.error('Search error:', err);
    empty.textContent = 'Search failed. Please try again.';
    empty.classList.remove('hidden');
  }
}

// ============================================================
// 11. DETAILS VIEW
// ============================================================
async function openDetails(type, id) {
  showView('details');
  currentDetailsType = type;
  currentDetailsId = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const data = await getDetails(type, id);
    currentDetailsData = data;

    // Backdrop
    if (data.backdrop_path) {
      $('details-backdrop').style.backgroundImage = `url(${IMG_ORIGINAL}${data.backdrop_path})`;
    }

    // Poster
    const posterImg = $('details-poster');
    posterImg.src = data.poster_path ? `${IMG_W500}${data.poster_path}` : '';
    posterImg.alt = data.title || data.name;

    // Title
    $('details-title').textContent = data.title || data.name;

    // Meta
    const rating = data.vote_average ? `<span class="rating">★ ${data.vote_average.toFixed(1)}</span>` : '';
    const year = (data.release_date || data.first_air_date || '').substring(0, 4);
    const runtime = data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : '';
    const seasons = data.number_of_seasons ? `${data.number_of_seasons} Season${data.number_of_seasons > 1 ? 's' : ''}` : '';
    $('details-meta').innerHTML = [rating, year, runtime, seasons, type === 'tv' ? 'TV Show' : 'Movie']
      .filter(Boolean)
      .map((item, i, arr) => item + (i < arr.length - 1 ? '<span class="separator"></span>' : ''))
      .join('');

    // Genres
    $('details-genres').innerHTML = (data.genres || [])
      .map(g => `<span class="genre-pill">${g.name}</span>`).join('');

    // Overview
    $('details-overview').textContent = data.overview || 'No overview available.';

    // Play button
    $('details-play-btn').onclick = () => {
      if (type === 'tv') {
        // For TV, scroll to episodes
        $('seasons-section').scrollIntoView({ behavior: 'smooth' });
      } else {
        playMedia(type, id);
      }
    };
    $('details-play-btn').innerHTML = type === 'tv'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Browse Episodes`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now`;

    // Cast
    const castScroll = $('cast-scroll');
    if (data.credits && data.credits.cast && data.credits.cast.length > 0) {
      castScroll.innerHTML = data.credits.cast.slice(0, 20).map(person => `
        <div class="cast-card">
          <div class="cast-avatar">
            ${person.profile_path ? `<img src="${IMG_W185}${person.profile_path}" alt="${person.name}" loading="lazy">` : ''}
          </div>
          <div class="cast-name">${person.name}</div>
          <div class="cast-character">${person.character || ''}</div>
        </div>
      `).join('');
      $('cast-section').classList.remove('hidden');
    } else {
      $('cast-section').classList.add('hidden');
    }

    // Seasons (TV)
    const seasonsSection = $('seasons-section');
    if (type === 'tv' && data.seasons && data.seasons.length > 0) {
      const validSeasons = data.seasons.filter(s => s.season_number > 0);
      const seasonTabs = $('season-tabs');
      seasonTabs.innerHTML = validSeasons.map((s, i) => `
        <button class="season-tab ${i === 0 ? 'active' : ''}" data-season="${s.season_number}">
          Season ${s.season_number}
        </button>
      `).join('');

      seasonTabs.addEventListener('click', e => {
        if (e.target.classList.contains('season-tab')) {
          seasonTabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          loadEpisodes(id, parseInt(e.target.dataset.season));
        }
      });

      if (validSeasons.length > 0) {
        await loadEpisodes(id, validSeasons[0].season_number);
      }
      seasonsSection.classList.remove('hidden');
    } else {
      seasonsSection.classList.add('hidden');
    }

    // Similar
    const similarRow = $('similar-row');
    if (data.similar && data.similar.results && data.similar.results.length > 0) {
      similarRow.innerHTML = data.similar.results
        .map(i => ({ ...i, media_type: type }))
        .map(createCardHTML).join('');
      $('similar-section').classList.remove('hidden');
    } else {
      $('similar-section').classList.add('hidden');
    }

  } catch (err) {
    console.error('Failed to load details:', err);
    $('details-title').textContent = 'Failed to load';
    $('details-overview').textContent = 'Please try again later.';
  }
}

async function loadEpisodes(tvId, seasonNumber) {
  const grid = $('episodes-grid');
  grid.innerHTML = '<p style="color: var(--text-tertiary); padding: 20px;">Loading episodes...</p>';

  try {
    const season = await getSeasonDetails(tvId, seasonNumber);
    if (!season.episodes || season.episodes.length === 0) {
      grid.innerHTML = '<p style="color: var(--text-tertiary); padding: 20px;">No episodes found.</p>';
      return;
    }

    grid.innerHTML = season.episodes.map(ep => `
      <div class="episode-card" onclick="playMedia('tv', ${tvId}, ${seasonNumber}, ${ep.episode_number})">
        <div class="episode-still">
          ${ep.still_path ? `<img src="${IMG_W300}${ep.still_path}" alt="Episode ${ep.episode_number}" loading="lazy">` : ''}
          <div class="ep-play">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="white"/></svg>
          </div>
        </div>
        <div class="episode-info">
          <div class="episode-number">Episode ${ep.episode_number}</div>
          <div class="episode-title">${ep.name || `Episode ${ep.episode_number}`}</div>
          <div class="episode-overview">${ep.overview || ''}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load episodes:', err);
    grid.innerHTML = '<p style="color: var(--text-tertiary); padding: 20px;">Failed to load episodes.</p>';
  }
}

// ============================================================
// 12. PLAY MEDIA — CinePro Integration
// ============================================================
async function playMedia(type, id, season = null, episode = null) {
  // Show the source modal with loading state
  const overlay = $('server-modal-overlay');
  const body = $('server-modal-body');
  const title = $('server-modal-title');

  title.textContent = 'Finding Sources...';
  body.innerHTML = `
    <div class="source-loading">
      <div class="source-spinner"></div>
      <p class="source-loading-text">Scanning providers for the best streams...</p>
      <p class="source-loading-sub">This may take a few seconds</p>
    </div>
  `;
  overlay.classList.add('active');

  try {
    // Ensure we have TMDB details for the title
    if (!currentDetailsData || currentDetailsData.id !== id) {
      currentDetailsData = await getDetails(type, id);
      currentDetailsType = type;
      currentDetailsId = id;
    }

    const mediaTitle = (currentDetailsData.title || currentDetailsData.name || 'Unknown') +
      (season ? ` S${season}E${episode}` : '');

    // Fetch sources from CinePro Core
    const result = await fetchStreamSources(type, id, season, episode);
    lastFetchedSources = result;

    if (!result.sources || result.sources.length === 0) {
      title.textContent = 'No Sources Found';
      body.innerHTML = `
        <div class="source-empty">
          <div class="source-empty-icon">🎬</div>
          <p class="source-empty-text">No streaming sources are available for this title right now.</p>
          <p class="source-empty-sub">Providers may be temporarily down. Try again later.</p>
          <button class="btn btn-glass" onclick="document.getElementById('server-modal-overlay').classList.remove('active')">Close</button>
        </div>
      `;
      return;
    }

    // Show the source picker with all available sources
    title.textContent = 'Available Sources';
    body.innerHTML = buildSourceList(result.sources, result.subtitles, mediaTitle);

    // Keep the overlay active so the user can choose their preferred server
    // (We removed the auto-play logic per user request so it never gets stuck!)
  } catch (err) {
    console.error('[CinePro] Stream fetch error:', err);
    title.textContent = 'Connection Error';
    body.innerHTML = `
      <div class="source-empty">
        <div class="source-empty-icon">⚠️</div>
        <p class="source-empty-text">${err.message || 'Failed to connect to streaming backend.'}</p>
        <p class="source-empty-sub">The server may be waking up from sleep. Try again in 30 seconds.</p>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 16px;">
          <button class="btn btn-primary" onclick="playMedia('${type}', ${id}, ${season}, ${episode})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Retry
          </button>
          <button class="btn btn-glass" onclick="document.getElementById('server-modal-overlay').classList.remove('active')">Close</button>
        </div>
      </div>
    `;
  }
}

function buildSourceList(sources, subtitles, mediaTitle) {
  // Group sources by provider
  const byProvider = {};
  sources.forEach(src => {
    const key = src.provider || 'Unknown';
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(src);
  });

  let html = '';
  for (const [providerName, providerSources] of Object.entries(byProvider)) {
    html += `<div class="source-provider-group">`;
    html += `<div class="source-provider-name"><span class="provider-dot"></span>${providerName}</div>`;
    html += `<div class="source-grid">`;

    providerSources.forEach((src, i) => {
      const qualityClass = getQualityClass(src.quality);
      const typeLabel = src.type?.toUpperCase() || 'HLS';
      const audioLabel = src.audioTracks?.length > 0
        ? src.audioTracks.map(a => a.label || a.language).join(', ')
        : '';

      html += `
        <button class="source-btn" onclick="playSource(${JSON.stringify(src).replace(/"/g, '&quot;')}, '${subtitles ? btoa(JSON.stringify(subtitles)) : ''}', '${mediaTitle.replace(/'/g, "\\'")}')">
          <div class="source-quality ${qualityClass}">${src.quality || '?'}</div>
          <div class="source-type">${typeLabel}</div>
          ${audioLabel ? `<div class="source-audio">${audioLabel}</div>` : ''}
        </button>
      `;
    });

    html += `</div></div>`;
  }

  return html;
}

function getQualityClass(quality) {
  if (!quality) return '';
  const q = quality.toLowerCase();
  if (q.includes('2160') || q.includes('4k')) return 'quality-4k';
  if (q.includes('1080')) return 'quality-1080';
  if (q.includes('720')) return 'quality-720';
  return 'quality-sd';
}

// Called when user manually picks a source from the modal
window.playSource = function (source, subtitlesB64, mediaTitle) {
  let subtitles = [];
  try {
    if (subtitlesB64) subtitles = JSON.parse(atob(subtitlesB64));
  } catch (e) { /* ignore */ }

  $('server-modal-overlay').classList.remove('active');
  openPlayer({
    url: source.url,
    referer: '',
    subtitles: subtitles,
    isIframe: false,
  }, mediaTitle);
};

// Allow switching sources while player is open
window.openSourcePicker = function () {
  if (!lastFetchedSources || !lastFetchedSources.sources) return;

  const overlay = $('server-modal-overlay');
  const body = $('server-modal-body');
  const title = $('server-modal-title');

  const mediaTitle = playerMediaTitle?.textContent || '';
  title.textContent = 'Switch Source';
  body.innerHTML = buildSourceList(lastFetchedSources.sources, lastFetchedSources.subtitles, mediaTitle);
  overlay.classList.add('active');
};

// ============================================================
// 13. SPA ROUTER
// ============================================================
function showView(view) {
  currentView = view;
  const views = ['home-view', 'movies-view', 'tv-view', 'search-view', 'details-view'];
  views.forEach(v => {
    const el = $(v);
    if (el) {
      if (v === `${view}-view`) {
        el.classList.remove('hidden');
        if (el.classList.contains('details-view')) el.classList.add('active');
      } else {
        el.classList.add('hidden');
        if (el.classList.contains('details-view')) el.classList.remove('active');
      }
    }
  });

  // Update nav active state
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  // Show/hide footer
  const footer = $('main-footer');
  if (footer) {
    footer.style.display = (view === 'details') ? 'none' : '';
  }
}

function navigateTo(view, params = {}) {
  if (view === 'home') {
    showView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (view === 'movies') {
    showView('movies');
    moviePage = 1;
    $('movies-grid').innerHTML = '';
    loadCategoryView('movie');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (view === 'tv') {
    showView('tv');
    tvPage = 1;
    $('tv-grid').innerHTML = '';
    loadCategoryView('tv');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (view === 'search') {
    showView('search');
    if (params.query) performSearch(params.query);
  }
}

// ============================================================
// 14. NAVIGATION & SEARCH EVENTS
// ============================================================

// Scroll behavior for nav
let lastScrollY = 0;
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
  lastScrollY = window.scrollY;
}, { passive: true });

// Search toggle
searchBtn.addEventListener('click', () => {
  if (navSearch.classList.contains('expanded')) {
    if (searchInput.value.trim()) {
      navigateTo('search', { query: searchInput.value.trim() });
    } else {
      navSearch.classList.remove('expanded');
    }
  } else {
    navSearch.classList.add('expanded');
    searchInput.focus();
  }
});

// Search on Enter
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && searchInput.value.trim()) {
    navigateTo('search', { query: searchInput.value.trim() });
  }
  if (e.key === 'Escape') {
    navSearch.classList.remove('expanded');
    searchInput.value = '';
    searchInput.blur();
  }
});

// Close search on blur if empty
searchInput.addEventListener('blur', () => {
  if (!searchInput.value.trim()) {
    setTimeout(() => navSearch.classList.remove('expanded'), 200);
  }
});

// ============================================================
// 15. PWA INSTALL
// ============================================================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;

  // Show banner after a delay
  setTimeout(() => {
    if (!localStorage.getItem('eclipse_pwa_dismissed')) {
      $('pwa-banner').classList.add('show');
    }
  }, 5000);
});

$('pwa-install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      $('pwa-banner').classList.remove('show');
    }
    deferredPrompt = null;
  }
});

$('pwa-dismiss-btn').addEventListener('click', () => {
  $('pwa-banner').classList.remove('show');
  localStorage.setItem('eclipse_pwa_dismissed', 'true');
});

// ============================================================
// 16. CINEPRO URL CONFIG
// ============================================================
// Allow setting the CinePro URL via console for easy configuration
window.setCineProUrl = function (url) {
  localStorage.setItem('eclipse_cinepro_url', url.replace(/\/$/, ''));
  console.log(`[Eclipse] CinePro URL set to: ${url}`);
  location.reload();
};

// ============================================================
// 17. SERVER MODAL EVENTS
// ============================================================
$('server-modal-close').addEventListener('click', () => {
  $('server-modal-overlay').classList.remove('active');
});

$('server-modal-overlay').addEventListener('click', e => {
  if (e.target === $('server-modal-overlay')) {
    $('server-modal-overlay').classList.remove('active');
  }
});

// ============================================================
// 18. INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Check if CinePro URL is configured
  if (CINEPRO_API.includes('your-cinepro-instance')) {
    console.log(
      '%c⚡ Eclipse — CinePro URL not configured!\n' +
      '%cRun this in console to set your CinePro Core backend URL:\n' +
      '%csetCineProUrl("https://your-cinepro-instance.onrender.com")',
      'color: #e50914; font-size: 14px; font-weight: bold;',
      'color: #aaa; font-size: 12px;',
      'color: #4CAF50; font-size: 12px; font-family: monospace;'
    );
  } else {
    // Warm up the backend and start keep-alive
    warmUpBackend();
    startKeepAlive();
  }

  loadHome();
});
