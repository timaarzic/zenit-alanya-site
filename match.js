(() => {
  const config = window.ZENIT_MATCH_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const safeImage = (value) => /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(String(value || '')) ? value : '';
  const lang = () => document.documentElement.lang === 'tr' ? 'tr' : 'ru';
  const tr = (ru, turkish) => lang() === 'tr' ? turkish : ru;
  const isConfigured = Boolean(config.supabaseUrl && config.publishableKey);
  const sessionKey = 'zenit-match-admin-session';

  const formationPositions = {
    '4-3-3': [[50,91],[16,74],[38,77],[62,77],[84,74],[25,53],[50,59],[75,53],[19,27],[50,20],[81,27]],
    '4-4-2': [[50,91],[16,74],[38,77],[62,77],[84,74],[15,49],[38,54],[62,54],[85,49],[35,23],[65,23]],
    '4-2-3-1': [[50,91],[16,75],[38,78],[62,78],[84,75],[35,59],[65,59],[18,39],[50,42],[82,39],[50,18]],
    '3-5-2': [[50,91],[23,75],[50,79],[77,75],[12,49],[33,55],[50,45],[67,55],[88,49],[34,21],[66,21]],
    '3-4-3': [[50,91],[23,75],[50,79],[77,75],[16,51],[39,56],[61,56],[84,51],[18,24],[50,18],[82,24]],
    '5-3-2': [[50,91],[10,67],[28,76],[50,79],[72,76],[90,67],[25,48],[50,55],[75,48],[35,22],[65,22]],
    '4-1-4-1': [[50,91],[16,74],[38,78],[62,78],[84,74],[50,62],[14,42],[38,46],[62,46],[86,42],[50,18]]
  };

  const defaultPlayers = formationPositions['4-3-3'].map(([x, y], index) => ({
    id: `player-${index + 1}`,
    number: index + 1,
    name: `Игрок ${index + 1}`,
    role: 'field',
    x,
    y,
    stats: { goals: 0, assists: 0, yellow: 0, red: 0 }
  }));

  const defaultState = {
    version: 1,
    match: {
      awayName: 'Соперник уточняется', awayLogo: '', homeScore: 0, awayScore: 0,
      date: '', time: '', venue: 'Поле уточняется', status: 'scheduled'
    },
    formation: '4-3-3',
    players: defaultPlayers,
    motm: { name: '', photo: '' }
  };

  let state = structuredClone(defaultState);
  let accessToken = '';
  let adminMode = false;
  let dirty = false;
  let pollTimer = null;

  const normalizeState = (incoming) => {
    const next = incoming && typeof incoming === 'object' ? incoming : {};
    const suppliedMatch = next.match && typeof next.match === 'object' ? next.match : {};
    const match = {
      awayName: String(suppliedMatch.awayName || defaultState.match.awayName).slice(0, 50),
      awayLogo: safeImage(suppliedMatch.awayLogo),
      homeScore: clamp(Number(suppliedMatch.homeScore) || 0, 0, 99),
      awayScore: clamp(Number(suppliedMatch.awayScore) || 0, 0, 99),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(suppliedMatch.date || '')) ? suppliedMatch.date : '',
      time: /^\d{2}:\d{2}$/.test(String(suppliedMatch.time || '')) ? suppliedMatch.time : '',
      venue: String(suppliedMatch.venue || defaultState.match.venue).slice(0, 100),
      status: ['scheduled', 'live', 'finished'].includes(suppliedMatch.status) ? suppliedMatch.status : 'scheduled'
    };
    const players = Array.isArray(next.players) ? next.players.map((player, index) => ({
      id: String(player.id || `player-${Date.now()}-${index}`),
      number: clamp(Number(player.number) || index + 1, 1, 99),
      name: String(player.name || `Игрок ${index + 1}`).slice(0, 40),
      role: player.role === 'bench' ? 'bench' : 'field',
      x: clamp(Number(player.x) || 50, 4, 96),
      y: clamp(Number(player.y) || 50, 5, 95),
      stats: {
        goals: clamp(Number(player.stats?.goals) || 0, 0, 20),
        assists: clamp(Number(player.stats?.assists) || 0, 0, 20),
        yellow: clamp(Number(player.stats?.yellow) || 0, 0, 2),
        red: clamp(Number(player.stats?.red) || 0, 0, 1)
      }
    })) : structuredClone(defaultPlayers);
    return {
      version: 1,
      match,
      formation: formationPositions[next.formation] ? next.formation : '4-3-3',
      players,
      motm: {
        name: String(next.motm?.name || '').slice(0, 50),
        photo: safeImage(next.motm?.photo)
      }
    };
  };

  const api = async (path, options = {}) => {
    if (!isConfigured) throw new Error('not-configured');
    const headers = {
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, headers });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) { /* no-op */ }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };

  const setSyncStatus = (text, tone = '') => {
    const element = $('#sync-status');
    if (!element) return;
    element.textContent = text;
    element.dataset.tone = tone;
  };

  const loadState = async ({ quiet = false } = {}) => {
    if (!isConfigured) {
      setSyncStatus(tr('Матч-центр готовится к подключению', 'Maç merkezi bağlantıya hazırlanıyor'));
      renderAll();
      return;
    }
    try {
      if (!quiet) setSyncStatus(tr('Обновляем данные матча…', 'Maç verileri güncelleniyor…'));
      const rows = await api('/rest/v1/match_state?id=eq.main&select=data,updated_at');
      if (rows?.[0]?.data && !(adminMode && dirty)) state = normalizeState(rows[0].data);
      const updated = rows?.[0]?.updated_at ? new Date(rows[0].updated_at) : null;
      const time = updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleTimeString(lang() === 'tr' ? 'tr-TR' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
      setSyncStatus(time ? tr(`Обновлено в ${time}`, `${time} tarihinde güncellendi`) : tr('Данные матча актуальны', 'Maç verileri güncel'), 'ok');
      renderAll();
    } catch (error) {
      setSyncStatus(tr('Не удалось обновить данные. Повторим автоматически.', 'Veriler güncellenemedi. Otomatik olarak tekrar denenecek.'), 'error');
    }
  };

  const formatDate = (value) => {
    if (!value) return tr('Дата уточняется', 'Tarih netleşiyor');
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(lang() === 'tr' ? 'tr-TR' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const statusLabel = (value) => ({
    scheduled: tr('Матч запланирован', 'Maç planlandı'),
    live: tr('Матч идёт', 'Maç oynanıyor'),
    finished: tr('Матч завершён', 'Maç bitti')
  })[value] || value;

  const renderScoreboard = () => {
    $('#home-score').textContent = state.match.homeScore;
    $('#away-score').textContent = state.match.awayScore;
    $('#away-name').textContent = state.match.awayName || tr('Соперник уточняется', 'Rakip netleşiyor');
    $('#match-date').textContent = formatDate(state.match.date);
    $('#match-time').textContent = state.match.time || '—';
    $('#match-venue').textContent = state.match.venue || tr('Поле уточняется', 'Saha netleşiyor');
    $('#match-status').textContent = statusLabel(state.match.status);
    $('#match-status').dataset.status = state.match.status;
    const awayLogo = $('#away-logo');
    awayLogo.innerHTML = safeImage(state.match.awayLogo)
      ? `<img src="${state.match.awayLogo}" alt="${tr('Логотип соперника', 'Rakip logosu')}">`
      : '<svg class="ui-icon" aria-hidden="true"><use href="icons.svg#shield"></use></svg>';
  };

  const playerNode = (player) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'pitch-player';
    element.dataset.playerId = player.id;
    element.style.left = `${player.x}%`;
    element.style.top = `${player.y}%`;
    element.innerHTML = `<span class="player-disc">${player.number}</span><span class="player-label">${escapeHtml(player.name)}</span>`;
    if (!adminMode) element.tabIndex = -1;
    return element;
  };

  const renderPitch = () => {
    $('#formation-title').textContent = `${tr('Схема', 'Diziliş')} ${state.formation}`;
    const layer = $('#players-layer');
    layer.innerHTML = '';
    state.players.filter((player) => player.role === 'field').slice(0, 11).forEach((player) => layer.append(playerNode(player)));
    $('#pitch-help').hidden = !adminMode;
  };

  const statBadges = (stats) => {
    const items = [];
    if (stats.goals) items.push(`<span class="stat-token goal-token" title="${tr('Голы', 'Goller')}"><b>G</b>${stats.goals}</span>`);
    if (stats.assists) items.push(`<span class="stat-token assist-token" title="${tr('Голевые передачи', 'Asistler')}"><b>A</b>${stats.assists}</span>`);
    if (stats.yellow) items.push(`<span class="stat-token yellow-token" title="${tr('Жёлтые карточки', 'Sarı kartlar')}"><i></i>${stats.yellow}</span>`);
    if (stats.red) items.push(`<span class="stat-token red-token" title="${tr('Красные карточки', 'Kırmızı kartlar')}"><i></i>${stats.red}</span>`);
    return items.join('');
  };

  const renderBench = () => {
    const bench = state.players.filter((player) => player.role === 'bench');
    $('#bench-list').innerHTML = bench.length ? bench.map((player) => `<div class="bench-player"><span>${player.number}</span><strong>${escapeHtml(player.name)}</strong><div>${statBadges(player.stats)}</div></div>`).join('') : `<p class="empty-note">${tr('Состав запасных будет опубликован перед матчем.', 'Yedek kadro maçtan önce yayınlanacak.')}</p>`;
  };

  const renderEvents = () => {
    const events = [];
    state.players.forEach((player) => {
      if (player.stats.goals) events.push({ type: 'goal', mark: 'G', label: tr('Гол', 'Gol'), player, count: player.stats.goals });
      if (player.stats.assists) events.push({ type: 'assist', mark: 'A', label: tr('Голевая передача', 'Asist'), player, count: player.stats.assists });
      if (player.stats.yellow) events.push({ type: 'yellow', mark: '', label: tr('Жёлтая карточка', 'Sarı kart'), player, count: player.stats.yellow });
      if (player.stats.red) events.push({ type: 'red', mark: '', label: tr('Красная карточка', 'Kırmızı kart'), player, count: player.stats.red });
    });
    $('#events-list').innerHTML = events.length ? events.map((event) => `<div class="event-row"><span class="event-symbol ${event.type}">${event.mark}</span><div><strong>${escapeHtml(event.player.name)}</strong><span>${event.label}${event.count > 1 ? ` × ${event.count}` : ''}</span></div><b>№${event.player.number}</b></div>`).join('') : `<p class="empty-note">${tr('Событий пока нет. Протокол обновится во время матча.', 'Henüz olay yok. Maç raporu oyun sırasında güncellenecek.')}</p>`;
  };

  const renderMotm = () => {
    const photo = $('#motm-photo');
    photo.innerHTML = safeImage(state.motm.photo) ? `<img src="${state.motm.photo}" alt="${tr('Лучший игрок матча', 'Maçın oyuncusu')}">` : '<svg class="ui-icon" aria-hidden="true"><use href="icons.svg#user"></use></svg>';
    const name = $('#motm-name');
    name.textContent = state.motm.name || tr('Будет объявлен после игры', 'Maçtan sonra açıklanacak');
  };

  const renderRosterEditor = () => {
    const editor = $('#roster-editor');
    if (!editor || !adminMode) return;
    editor.innerHTML = state.players.map((player) => `<article class="roster-row" data-player-id="${player.id}">
      <div class="roster-identity"><input class="roster-number" type="number" min="1" max="99" value="${player.number}" aria-label="${tr('Номер игрока', 'Oyuncu numarası')}"><input class="roster-name" type="text" maxlength="40" value="${escapeHtml(player.name)}" aria-label="${tr('Имя игрока', 'Oyuncu adı')}"><select class="roster-role" aria-label="${tr('Роль игрока', 'Oyuncu rolü')}"><option value="field" ${player.role === 'field' ? 'selected' : ''}>${tr('Поле', 'Saha')}</option><option value="bench" ${player.role === 'bench' ? 'selected' : ''}>${tr('Запас', 'Yedek')}</option></select></div>
      <div class="roster-stats">
        <div class="counter-control"><span>G</span><button type="button" data-stat="goals" data-delta="-1">−</button><b>${player.stats.goals}</b><button type="button" data-stat="goals" data-delta="1">+</button></div>
        <div class="counter-control"><span>A</span><button type="button" data-stat="assists" data-delta="-1">−</button><b>${player.stats.assists}</b><button type="button" data-stat="assists" data-delta="1">+</button></div>
        <div class="counter-control card-counter yellow-counter"><span></span><button type="button" data-stat="yellow" data-delta="-1">−</button><b>${player.stats.yellow}</b><button type="button" data-stat="yellow" data-delta="1">+</button></div>
        <div class="counter-control card-counter red-counter"><span></span><button type="button" data-stat="red" data-delta="-1">−</button><b>${player.stats.red}</b><button type="button" data-stat="red" data-delta="1">+</button></div>
        <button class="remove-player" type="button" title="${tr('Удалить игрока', 'Oyuncuyu sil')}"><svg class="ui-icon" aria-hidden="true"><use href="icons.svg#trash"></use></svg></button>
      </div>
    </article>`).join('');
  };

  const renderAdminFields = () => {
    if (!adminMode) return;
    $('#edit-away-name').value = state.match.awayName || '';
    $('#edit-home-score').value = state.match.homeScore;
    $('#edit-away-score').value = state.match.awayScore;
    $('#edit-date').value = state.match.date || '';
    $('#edit-time').value = state.match.time || '';
    $('#edit-venue').value = state.match.venue || '';
    $('#edit-status').value = state.match.status;
    $('#formation-select').value = state.formation;
    $('#edit-motm-name').value = state.motm.name || '';
    renderRosterEditor();
  };

  const renderAll = () => {
    renderScoreboard(); renderPitch(); renderBench(); renderEvents(); renderMotm(); renderAdminFields();
  };

  const markDirty = () => {
    dirty = true;
    const message = $('#save-message');
    if (message) message.textContent = tr('Есть несохранённые изменения.', 'Kaydedilmemiş değişiklikler var.');
  };

  const syncStateFromFields = () => {
    state.match.awayName = $('#edit-away-name').value.trim() || tr('Соперник уточняется', 'Rakip netleşiyor');
    state.match.homeScore = clamp(Number($('#edit-home-score').value) || 0, 0, 99);
    state.match.awayScore = clamp(Number($('#edit-away-score').value) || 0, 0, 99);
    state.match.date = $('#edit-date').value;
    state.match.time = $('#edit-time').value;
    state.match.venue = $('#edit-venue').value.trim() || tr('Поле уточняется', 'Saha netleşiyor');
    state.match.status = $('#edit-status').value;
    state.motm.name = $('#edit-motm-name').value.trim();
  };

  const imageToDataUrl = (file, maxSize = 720) => new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) return reject(new Error('invalid-image'));
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const applyFormation = (formation) => {
    const positions = formationPositions[formation];
    if (!positions) return;
    const fieldPlayers = state.players.filter((player) => player.role === 'field').slice(0, 11);
    fieldPlayers.forEach((player, index) => { if (positions[index]) [player.x, player.y] = positions[index]; });
    state.formation = formation;
    markDirty(); renderPitch();
  };

  const saveMatch = async () => {
    syncStateFromFields(); renderAll();
    if (!accessToken) {
      $('#save-message').textContent = tr('Сессия завершена. Войдите снова.', 'Oturum sona erdi. Tekrar giriş yapın.');
      return;
    }
    const buttons = [$('#save-match'), $('#save-match-bottom')];
    buttons.forEach((button) => { if (button) button.disabled = true; });
    $('#save-message').textContent = tr('Сохраняем изменения…', 'Değişiklikler kaydediliyor…');
    try {
      await api('/rest/v1/match_state?id=eq.main', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'return=minimal' },
        body: JSON.stringify({ data: state, updated_at: new Date().toISOString() })
      });
      dirty = false;
      $('#save-message').textContent = tr('Сохранено. Обновление уже видно всем посетителям.', 'Kaydedildi. Güncelleme tüm ziyaretçilere gösteriliyor.');
      setSyncStatus(tr('Изменения опубликованы', 'Değişiklikler yayınlandı'), 'ok');
    } catch (error) {
      $('#save-message').textContent = tr('Не удалось сохранить. Проверьте соединение или войдите снова.', 'Kaydedilemedi. Bağlantıyı kontrol edin veya tekrar giriş yapın.');
    } finally {
      buttons.forEach((button) => { if (button) button.disabled = false; });
    }
  };

  const openAdmin = () => {
    const section = $('#admin-section');
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (accessToken) showAdminPanel();
  };

  const showAdminPanel = () => {
    adminMode = true;
    $('#admin-login').hidden = true;
    $('#admin-panel').hidden = false;
    renderAll();
  };

  const logout = () => {
    accessToken = '';
    adminMode = false;
    dirty = false;
    sessionStorage.removeItem(sessionKey);
    $('#admin-login').hidden = false;
    $('#admin-panel').hidden = true;
    $('#admin-password').value = '';
    renderAll();
  };

  const login = async (password) => {
    if (!isConfigured) throw new Error('not-configured');
    const result = await api('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: config.adminEmail, password })
    });
    if (!result?.access_token) throw new Error('auth-failed');
    accessToken = result.access_token;
    sessionStorage.setItem(sessionKey, JSON.stringify({ token: result.access_token, expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000 }));
  };

  $('#admin-open')?.addEventListener('click', openAdmin);
  $('#admin-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const message = $('#login-message');
    submit.disabled = true;
    message.textContent = tr('Проверяем доступ…', 'Erişim kontrol ediliyor…');
    try {
      await login($('#admin-password').value);
      $('#admin-password').value = '';
      message.textContent = '';
      showAdminPanel();
    } catch (error) {
      message.textContent = error.message === 'not-configured' ? tr('Защищённый backend ещё подключается.', 'Güvenli arka uç henüz bağlanıyor.') : tr('Неверный пароль или доступ временно недоступен.', 'Şifre yanlış veya erişim geçici olarak kullanılamıyor.');
    } finally { submit.disabled = false; }
  });

  $('#admin-logout')?.addEventListener('click', logout);
  $('#save-match')?.addEventListener('click', saveMatch);
  $('#save-match-bottom')?.addEventListener('click', saveMatch);

  ['#edit-away-name','#edit-home-score','#edit-away-score','#edit-date','#edit-time','#edit-venue','#edit-status','#edit-motm-name'].forEach((selector) => {
    $(selector)?.addEventListener('input', () => { syncStateFromFields(); markDirty(); renderScoreboard(); renderMotm(); });
  });

  $('#formation-select')?.addEventListener('change', (event) => applyFormation(event.target.value));

  $('#edit-away-logo')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { state.match.awayLogo = await imageToDataUrl(file); markDirty(); renderScoreboard(); } catch (_) { /* input remains available */ }
  });

  $('#edit-motm-photo')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { state.motm.photo = await imageToDataUrl(file); markDirty(); renderMotm(); } catch (_) { /* input remains available */ }
  });

  $('#add-player-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    let role = $('#player-role').value;
    if (role === 'field' && state.players.filter((player) => player.role === 'field').length >= 11) role = 'bench';
    state.players.push({
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      number: clamp(Number($('#player-number').value) || 1, 1, 99),
      name: $('#player-name').value.trim(), role, x: 50, y: 50,
      stats: { goals: 0, assists: 0, yellow: 0, red: 0 }
    });
    event.currentTarget.reset(); markDirty(); renderAll();
  });

  $('#roster-editor')?.addEventListener('input', (event) => {
    const row = event.target.closest('.roster-row'); if (!row) return;
    const player = state.players.find((item) => item.id === row.dataset.playerId); if (!player) return;
    if (event.target.classList.contains('roster-name')) player.name = event.target.value.slice(0, 40);
    if (event.target.classList.contains('roster-number')) player.number = clamp(Number(event.target.value) || 1, 1, 99);
    if (event.target.classList.contains('roster-role')) {
      const nextRole = event.target.value;
      if (nextRole === 'field' && player.role !== 'field' && state.players.filter((item) => item.role === 'field').length >= 11) {
        event.target.value = 'bench';
      } else player.role = nextRole;
    }
    markDirty(); renderPitch(); renderBench(); renderEvents();
  });

  $('#roster-editor')?.addEventListener('click', (event) => {
    const row = event.target.closest('.roster-row'); if (!row) return;
    const player = state.players.find((item) => item.id === row.dataset.playerId); if (!player) return;
    const statButton = event.target.closest('[data-stat]');
    if (statButton) {
      const stat = statButton.dataset.stat;
      const max = stat === 'red' ? 1 : stat === 'yellow' ? 2 : 20;
      player.stats[stat] = clamp(player.stats[stat] + Number(statButton.dataset.delta), 0, max);
      markDirty(); renderRosterEditor(); renderBench(); renderEvents(); return;
    }
    if (event.target.closest('.remove-player')) {
      state.players = state.players.filter((item) => item.id !== player.id);
      markDirty(); renderAll();
    }
  });

  $('#players-layer')?.addEventListener('pointerdown', (event) => {
    if (!adminMode) return;
    const node = event.target.closest('.pitch-player'); if (!node) return;
    const player = state.players.find((item) => item.id === node.dataset.playerId); if (!player) return;
    const pitch = $('#football-pitch');
    node.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
    const move = (moveEvent) => {
      const rect = pitch.getBoundingClientRect();
      player.x = clamp(((moveEvent.clientX - rect.left) / rect.width) * 100, 4, 96);
      player.y = clamp(((moveEvent.clientY - rect.top) / rect.height) * 100, 5, 95);
      node.style.left = `${player.x}%`; node.style.top = `${player.y}%`;
      markDirty();
    };
    const end = () => { node.classList.remove('dragging'); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', end); };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
  });

  document.querySelectorAll('[data-lang]').forEach((button) => button.addEventListener('click', () => setTimeout(renderAll, 0)));

  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    if (saved?.token && saved.expiresAt > Date.now() + 30000) accessToken = saved.token;
    else sessionStorage.removeItem(sessionKey);
  } catch (_) { sessionStorage.removeItem(sessionKey); }

  state = normalizeState(state);
  renderAll();
  loadState();
  if (isConfigured) pollTimer = window.setInterval(() => loadState({ quiet: true }), 15000);
  window.addEventListener('beforeunload', () => { if (pollTimer) clearInterval(pollTimer); });
})();
