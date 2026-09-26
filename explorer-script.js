(function () {
  'use strict';

  var api = window.RbxApi;
  var abbr = api.abbr;

  // State
  var state = {
    query: '',
    sort: 'playing',
    limit: 20,
    page: 1,
    totalPages: 1,
    currentGame: null,
    chart: null
  };

  // DOM elements
  var searchInput = document.getElementById('searchInput');
  var sortSelect = document.getElementById('sortSelect');
  var limitSelect = document.getElementById('limitSelect');
  var gamesGrid = document.getElementById('gamesGrid');
  var emptyState = document.getElementById('emptyState');
  var loadingState = document.getElementById('loadingState');
  var summaryStats = document.getElementById('summaryStats');
  var totalGames = document.getElementById('totalGames');
  var totalPlaying = document.getElementById('totalPlaying');
  var totalVisits = document.getElementById('totalVisits');
  var avgRatio = document.getElementById('avgRatio');
  var resultsTitle = document.getElementById('resultsTitle');
  var pagination = document.getElementById('pagination');
  var prevPage = document.getElementById('prevPage');
  var nextPage = document.getElementById('nextPage');
  var pageInfo = document.getElementById('pageInfo');
  var emptyState = document.getElementById('emptyState');
  var loadingState = document.getElementById('loadingState');

  // Modal elements
  var gameModal = document.getElementById('gameModal');
  var modalClose = gameModal.querySelector('.modal-close');
  var modalBanner = document.getElementById('modalBanner');
  var modalThumbnail = document.getElementById('modalThumbnail');
  var modalTitle = document.getElementById('modalTitle');
  var modalCreator = document.getElementById('modalCreator');
  var modalCreatorLink = document.getElementById('modalCreatorLink');
  var modalCreatorType = document.getElementById('modalCreatorType');
  var modalPlaying = document.getElementById('modalPlaying');
  var modalVisits = document.getElementById('modalVisits');
  var modalLikes = document.getElementById('modalLikes');
  var modalFavorites = document.getElementById('modalFavorites');
  var modalRatio = document.getElementById('modalRatio');
  var modalMaxPlayers = document.getElementById('modalMaxPlayers');
  var modalDescription = document.getElementById('modalDescription');
  var modalUrl = document.getElementById('modalUrl');
  var copyIdBtn = document.getElementById('copyId');
  var copyEmbedBtn = document.getElementById('copyEmbed');
  var trendChart = document.getElementById('trendChart');

  // Debounce helper
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // Format numbers
  function formatNumber(n) {
    return abbr(n);
  }

  // Search with debounce
  var doSearch = debounce(function () {
    state.query = searchInput.value.trim();
    state.page = 1;
    loadGames();
  }, 300);

  searchInput.addEventListener('input', doSearch);
  sortSelect.addEventListener('change', function () {
    state.sort = this.value;
    state.page = 1;
    loadGames();
  });
  limitSelect.addEventListener('change', function () {
    state.limit = parseInt(this.value, 10);
    state.page = 1;
    loadGames();
  });

  prevPage.addEventListener('click', function () {
    if (state.page > 1) {
      state.page--;
      loadGames();
    }
  });

  nextPage.addEventListener('click', function () {
    if (state.page < state.totalPages) {
      state.page++;
      loadGames();
    }
  });

  // Modal close
  modalClose.addEventListener('click', closeModal);
  gameModal.addEventListener('click', function (e) {
    if (e.target === gameModal) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && gameModal.style.display !== 'none') closeModal();
  });

  // Copy buttons
  copyIdBtn.addEventListener('click', function () {
    if (state.currentGame) {
      navigator.clipboard.writeText(String(state.currentGame.id));
      copyIdBtn.textContent = 'Copied!';
      setTimeout(function () { copyIdBtn.textContent = 'Copy universeId'; }, 1500);
    }
  });

  copyEmbedBtn.addEventListener('click', function () {
    if (state.currentGame) {
      var code = '<div data-roblox-game="' + state.currentGame.id + '"></div>\n<script src="https://ms-mba.up.railway.app/roblox-stats.js"><\/script>';
      navigator.clipboard.writeText(code);
      copyEmbedBtn.textContent = 'Copied!';
      setTimeout(function () { copyEmbedBtn.textContent = 'Copy embed code'; }, 1500);
    }
  });

  function closeModal() {
    gameModal.style.display = 'none';
    document.body.style.overflow = '';
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  }

  function openModal(game) {
    state.currentGame = game;

    modalBanner.style.backgroundImage = game.banner ? 'url("' + game.banner + '")' : '';
    modalThumbnail.src = game.thumbnail || '';
    modalThumbnail.alt = game.name + ' logo';
    modalTitle.textContent = game.name;
    modalCreator.textContent = game.creator || 'Unknown';
    modalCreatorLink.href = game.creatorUrl || '#';
    modalCreatorType.textContent = game.creatorType || 'Unknown';

    modalPlaying.textContent = formatNumber(game.playing);
    modalVisits.textContent = formatNumber(game.visits);
    modalLikes.textContent = formatNumber(game.ratings?.upVotes || game.upVotes || 0);
    modalFavorites.textContent = formatNumber(game.ratings?.favorites || game.favorites || 0);
    modalRatio.textContent = (game.ratings?.upVoteRatio || game.upVoteRatio || 0).toFixed(1) + '%';
    modalMaxPlayers.textContent = formatNumber(game.maxPlayers);

    modalDescription.textContent = game.description || 'No description available.';
    modalUrl.href = game.url || '#';
    modalCreatorLink.href = game.creatorUrl || '#';

    gameModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Load trend chart
    loadTrendChart(game.id);
  }

  function loadTrendChart(gameId) {
    // Destroy existing chart
    if (state.chart) {
      state.chart.destroy();
    }

    var ctx = trendChart.getContext('2d');
    var now = new Date();
    var labels = [];
    var data = [];

    // Generate last 7 data points (simulated)
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setHours(d.getHours() - i);
      labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      var base = state.currentGame.playing || 0;
      var variance = Math.random() * 0.1 * base;
      data.push(Math.round(base + variance - 0.05 * base));
    }

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Players online',
          data: data,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() || '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
            titleColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
            bodyColor: getComputedStyle(document.documentElement).getPropertyValue('--text-soft').trim(),
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
            borderWidth: 1,
            padding: 12
          }
        },
        scales: {
          x: {
            grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }
          },
          y: {
            grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), callback: function (v) { return abbr(v); } }
          }
        }
      }
    });
  }

  function loadGames() {
    var url = '/api/v1/search?q=' + encodeURIComponent(state.query || '*') +
      '&limit=' + state.limit +
      '&page=' + state.page +
      '&sort=' + state.sort;

    if (state.query === '*') {
      // Use trending for empty query
      url = '/api/v1/trending?limit=' + state.limit + '&page=' + state.page + '&sort=' + state.sort;
    }

    showLoading(true);
    gamesGrid.innerHTML = '';
    emptyState.style.display = 'none';
    pagination.style.display = 'none';

    api.fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (body) {
        showLoading(false);

        if (!body.ok) {
          throw new Error(body.error?.message || 'Request failed');
        }

        var games = body.data || [];
        var meta = body.meta || {};

        state.totalPages = meta.totalPages || 1;

        if (games.length === 0) {
          gamesGrid.innerHTML = '';
          emptyState.style.display = 'flex';
          pagination.style.display = 'none';
          summaryStats.style.display = 'none';
          return;
        }

        renderGames(games);
        updateSummary(games);
        updatePagination();
        summaryStats.style.display = 'grid';
        pagination.style.display = 'flex';
      })
      .catch(function (err) {
        showLoading(false);
        gamesGrid.innerHTML = '';
        emptyState.style.display = 'flex';
        document.getElementById('emptyState').querySelector('h3').textContent = 'Error loading games';
        document.getElementById('emptyState').querySelector('p').textContent = err.message;
        console.error('[explorer] Load games error:', err);
      });
  }

  function renderGames(games) {
    gamesGrid.innerHTML = games.map(function (game) {
      var playing = game.playing || 0;
      var visits = game.visits || 0;
      var likes = game.ratings?.upVotes || game.upVotes || 0;
      var ratio = game.ratings?.upVoteRatio || game.upVoteRatio || 0;

      return '<article class="game-card" role="listitem" data-id="' + game.id + '" tabindex="0">' +
        '<div class="game-card-banner" style="background-image: url(' + (game.banner ? '"' + game.banner + '"' : '') + ')"></div>' +
        '<div class="game-card-content">' +
        '<img class="game-card-thumbnail" src="' + (game.thumbnail || '') + '" alt="" loading="lazy">' +
        '<h3 class="game-card-title">' + escapeHtml(game.name) + '</h3>' +
        '<p class="game-card-creator">by ' + escapeHtml(game.creator || 'Unknown') + '</p>' +
        '<div class="game-card-stats">' +
        '<span class="game-stat"><b>' + abbr(game.playing) + '</b><span>Playing</span></span>' +
        '<span class="game-stat"><b>' + abbr(game.ratings?.upVotes || game.upVotes || 0) + '</b><span>Likes</span></span>' +
        '<span class="game-stat"><b>' + abbr(game.visits) + '</b><span>Visits</span></span>' +
        '<span class="game-stat"><b>' + (game.ratings?.upVoteRatio || game.upVoteRatio || 0).toFixed(1) + '%</b><span>Ratio</span></span>' +
        '</div>' +
        '<p class="game-card-description">' + escapeHtml((game.description || '').slice(0, 120)) + (game.description && game.description.length > 120 ? '…' : '') + '</p>' +
        '</div>' +
        '</article>';
    }).join('');

    // Add click handlers
    gamesGrid.querySelectorAll('.game-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = Number(this.getAttribute('data-id'));
        var game = games.find(function (g) { return g.id === id; });
        if (game) openModal(game);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });
  }

  function updateSummary(games) {
    var totalP = games.reduce(function (sum, g) { return sum + (g.playing || 0); }, 0);
    var totalV = games.reduce(function (sum, g) { return sum + (g.visits || 0); }, 0);
    var avgR = games.reduce(function (sum, g) { return sum + (g.ratings?.upVoteRatio || g.upVoteRatio || 0); }, 0) / games.length;

    totalGames.textContent = abbr(games.length);
    totalPlaying.textContent = abbr(totalP);
    totalVisits.textContent = abbr(totalV);
    avgRatio.textContent = avgR.toFixed(1) + '%';
  }

  function updatePagination() {
    pageInfo.textContent = 'Page ' + state.page + ' of ' + state.totalPages;
    prevPage.disabled = state.page <= 1;
    nextPage.disabled = state.page >= state.totalPages;
  }

  function showLoading(show) {
    loadingState.style.display = show ? 'flex' : 'none';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, ''');
  }

  // Debounce helper
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // Search with debounce
  var doSearch = debounce(function () {
    state.query = searchInput.value.trim();
    state.page = 1;
    loadGames();
  }, 300);

  searchInput.addEventListener('input', doSearch);
  sortSelect.addEventListener('change', function () {
    state.sort = this.value;
    state.page = 1;
    loadGames();
  });
  limitSelect.addEventListener('change', function () {
    state.limit = parseInt(this.value, 10);
    state.page = 1;
    loadGames();
  });

  prevPage.addEventListener('click', function () {
    if (state.page > 1) {
      state.page--;
      loadGames();
    }
  });

  nextPage.addEventListener('click', function () {
    if (state.page < state.totalPages) {
      state.page++;
      loadGames();
    }
  });

  // Modal close
  modalClose.addEventListener('click', closeModal);
  gameModal.addEventListener('click', function (e) {
    if (e.target === gameModal) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && gameModal.style.display !== 'none') closeModal();
  });

  // Copy buttons
  copyIdBtn.addEventListener('click', function () {
    if (state.currentGame) {
      navigator.clipboard.writeText(String(state.currentGame.id));
      copyIdBtn.textContent = 'Copied!';
      setTimeout(function () { copyIdBtn.textContent = 'Copy universeId'; }, 1500);
    }
  });

  copyEmbedBtn.addEventListener('click', function () {
    if (state.currentGame) {
      var code = '<div data-roblox-game="' + state.currentGame.id + '"></div>\n<script src="https://ms-mba.up.railway.app/roblox-stats.js"><\/script>';
      navigator.clipboard.writeText(code);
      copyEmbedBtn.textContent = 'Copied!';
      setTimeout(function () { copyEmbedBtn.textContent = 'Copy embed code'; }, 1500);
    }
  });

  function closeModal() {
    gameModal.style.display = 'none';
    document.body.style.overflow = '';
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  }

  function openModal(game) {
    state.currentGame = game;

    modalBanner.style.backgroundImage = game.banner ? 'url("' + game.banner + '")' : '';
    modalThumbnail.src = game.thumbnail || '';
    modalThumbnail.alt = game.name + ' logo';
    modalTitle.textContent = game.name;
    modalCreator.textContent = game.creator || 'Unknown';
    modalCreatorLink.href = game.creatorUrl || '#';
    modalCreatorType.textContent = game.creatorType || 'Unknown';

    modalPlaying.textContent = formatNumber(game.playing);
    modalVisits.textContent = formatNumber(game.visits);
    modalLikes.textContent = formatNumber(game.ratings?.upVotes || game.upVotes || 0);
    modalFavorites.textContent = formatNumber(game.ratings?.favorites || game.favorites || 0);
    modalRatio.textContent = (game.ratings?.upVoteRatio || game.upVoteRatio || 0).toFixed(1) + '%';
    modalMaxPlayers.textContent = formatNumber(game.maxPlayers);

    modalDescription.textContent = game.description || 'No description available.';
    modalUrl.href = game.url || '#';
    modalCreatorLink.href = game.creatorUrl || '#';

    gameModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Load trend chart
    loadTrendChart(game.id);
  }

  function loadTrendChart(gameId) {
    // Destroy existing chart
    if (state.chart) {
      state.chart.destroy();
    }

    var ctx = trendChart.getContext('2d');
    var now = new Date();
    var labels = [];
    var data = [];

    // Generate last 7 data points (simulated)
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setHours(d.getHours() - i);
      labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      var base = state.currentGame.playing || 0;
      var variance = Math.random() * 0.1 * base;
      data.push(Math.round(base + variance - 0.05 * base));
    }

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Players online',
          data: data,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() || '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
            titleColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
            bodyColor: getComputedStyle(document.documentElement).getPropertyValue('--text-soft').trim(),
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
            borderWidth: 1,
            padding: 12
          }
        },
        scales: {
          x: {
            grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }
          },
          y: {
            grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), callback: function (v) { return abbr(v); } }
          }
        }
      }
    });
  }

  function loadGames() {
    var url = '/api/v1/search?q=' + encodeURIComponent(state.query || '*') +
      '&limit=' + state.limit +
      '&page=' + state.page +
      '&sort=' + state.sort;

    if (state.query === '*') {
      // Use trending for empty query
      url = '/api/v1/trending?limit=' + state.limit + '&page=' + state.page + '&sort=' + state.sort;
    }

    showLoading(true);
    gamesGrid.innerHTML = '';
    emptyState.style.display = 'none';
    pagination.style.display = 'none';

    api.fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (body) {
        showLoading(false);

        if (!body.ok) {
          throw new Error(body.error?.message || 'Request failed');
        }

        var games = body.data || [];
        var meta = body.meta || {};

        state.totalPages = meta.totalPages || 1;

        if (games.length === 0) {
          gamesGrid.innerHTML = '';
          emptyState.style.display = 'flex';
          pagination.style.display = 'none';
          summaryStats.style.display = 'none';
          return;
        }

        renderGames(games);
        updateSummary(games);
        updatePagination();
        summaryStats.style.display = 'grid';
        pagination.style.display = 'flex';
      })
      .catch(function (err) {
        showLoading(false);
        gamesGrid.innerHTML = '';
        emptyState.style.display = 'flex';
        document.getElementById('emptyState').querySelector('h3').textContent = 'Error loading games';
        document.getElementById('emptyState').querySelector('p').textContent = err.message;
        console.error('[explorer] Load games error:', err);
      });
  }

  function renderGames(games) {
    gamesGrid.innerHTML = games.map(function (game) {
      var playing = game.playing || 0;
      var visits = game.visits || 0;
      var likes = game.ratings?.upVotes || game.upVotes || 0;
      var ratio = game.ratings?.upVoteRatio || game.upVoteRatio || 0;

      return '<article class="game-card" role="listitem" data-id="' + game.id + '" tabindex="0">' +
        '<div class="game-card-banner" style="background-image: url(' + (game.banner ? '"' + game.banner + '"' : '') + ')"></div>' +
        '<div class="game-card-content">' +
        '<img class="game-card-thumbnail" src="' + (game.thumbnail || '') + '" alt="" loading="lazy">' +
        '<h3 class="game-card-title">' + escapeHtml(game.name) + '</h3>' +
        '<p class="game-card-creator">by ' + escapeHtml(game.creator || 'Unknown') + '</p>' +
        '<div class="game-card-stats">' +
        '<span class="game-stat"><b>' + abbr(game.playing) + '</b><span>Playing</span></span>' +
        '<span class="game-stat"><b>' + abbr(game.ratings?.upVotes || game.upVotes || 0) + '</b><span>Likes</span></span>' +
        '<span class="game-stat"><b>' + abbr(game.visits) + '</b><span>Visits</span></span>' +
        '<span class="game-stat"><b>' + (game.ratings?.upVoteRatio || game.upVoteRatio || 0).toFixed(1) + '%</b><span>Ratio</span></span>' +
        '</div>' +
        '<p class="game-card-description">' + escapeHtml((game.description || '').slice(0, 120)) + (game.description && game.description.length > 120 ? '…' : '') + '</p>' +
        '</div>' +
        '</article>';
    }).join('');

    // Add click handlers
    gamesGrid.querySelectorAll('.game-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = Number(this.getAttribute('data-id'));
        var game = games.find(function (g) { return g.id === id; });
        if (game) openModal(game);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });
  }

  function updateSummary(games) {
    var totalP = games.reduce(function (sum, g) { return sum + (g.playing || 0); }, 0);
    var totalV = games.reduce(function (sum, g) { return sum + (g.visits || 0); }, 0);
    var avgR = games.reduce(function (sum, g) { return sum + (g.ratings?.upVoteRatio || g.upVoteRatio || 0); }, 0) / games.length;

    totalGames.textContent = abbr(games.length);
    totalPlaying.textContent = abbr(totalP);
    totalVisits.textContent = abbr(totalV);
    avgRatio.textContent = avgR.toFixed(1) + '%';
  }

  function updatePagination() {
    pageInfo.textContent = 'Page ' + state.page + ' of ' + state.totalPages;
    prevPage.disabled = state.page <= 1;
    nextPage.disabled = state.page >= state.totalPages;
  }

  function showLoading(show) {
    loadingState.style.display = show ? 'flex' : 'none';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, ''');
  }

  // Initial load
  loadGames();

  // Expose for debugging
  window.explorerState = state;
})();