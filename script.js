(() => {
  'use strict';

  const cfg = window.FISIOLINK_CONFIG || {};
  const configured = Boolean(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !String(cfg.SUPABASE_URL).includes('COLE_AQUI') &&
    !String(cfg.SUPABASE_ANON_KEY).includes('COLE_AQUI')
  );

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const toastEl = $('#toast');
  const toast = (msg, error = false) => {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast = setTimeout(() => toastEl.classList.remove('show'), 3600);
  };

  let sb = null;
  let session = null;
  let profile = null;
  let videos = [];
  let selectedVideo = null;
  let progressRows = [];
  let appointments = [];
  let therapists = [];
  let contacts = [];
  let selectedContact = null;
  let messageChannel = null;
  let callGlobalChannel = null;
  let callChannel = null;
  let iceChannel = null;
  let incomingPoll = null;
  let callPoll = null;
  let currentCalendar = new Date();
  let localPreferences = {
    largeText: false,
    highContrast: false,
    reducedMotion: false,
    messageAlerts: true,
    appointmentAlerts: true
  };

  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingTimer = null;
  let recordingStarted = 0;

  let currentCall = null;
  let peer = null;
  let localStream = null;
  let remoteStream = null;
  let pendingIce = [];
  let remoteDescriptionSet = false;
  let callCleanupInProgress = false;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  if (!configured) {
    $('#setupWarning').classList.remove('hidden');
  } else {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  const authDialog = $('#authDialog');
  const videoDialog = $('#videoDialog');
  const appointmentDialog = $('#appointmentDialog');
  const callDialog = $('#callDialog');

  function initials(name = 'FL') {
    return String(name).trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'FL';
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function formatTime(value) {
    return value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  function readPreferences() {
    try {
      const raw = localStorage.getItem('fisiolink_preferences');
      if (raw) localPreferences = { ...localPreferences, ...JSON.parse(raw) };
    } catch (e) {
      console.warn('Preferências locais indisponíveis', e);
    }
    applyPreferences();
  }

  function savePreferences() {
    try { localStorage.setItem('fisiolink_preferences', JSON.stringify(localPreferences)); } catch (_) {}
    applyPreferences();
  }

  function applyPreferences() {
    document.body.classList.toggle('a11y-large', !!localPreferences.largeText);
    document.body.classList.toggle('a11y-contrast', !!localPreferences.highContrast);
    document.body.classList.toggle('a11y-reduced-motion', !!localPreferences.reducedMotion);
    const pairs = {
      prefLargeText: 'largeText',
      prefHighContrast: 'highContrast',
      prefReducedMotion: 'reducedMotion',
      prefMessageAlerts: 'messageAlerts',
      prefAppointmentAlerts: 'appointmentAlerts'
    };
    Object.entries(pairs).forEach(([id, key]) => {
      const el = $(`#${id}`);
      if (el) el.checked = !!localPreferences[key];
    });
  }

  function setAvatarElement(el, name, url = null) {
    if (!el) return;
    el.textContent = initials(name);
    el.classList.toggle('has-avatar', !!url);
    el.style.backgroundImage = url ? `url("${url}")` : '';
  }

  async function avatarUrl(path, seconds = 3600) {
    if (!path || !sb) return null;
    const { data, error } = await sb.storage.from('fisiolink-avatars').createSignedUrl(path, seconds);
    return error ? null : data?.signedUrl || null;
  }

  function switchAuth(mode) {
    $('#loginPanel').classList.toggle('hidden', mode !== 'login');
    $('#registerPanel').classList.toggle('hidden', mode !== 'register');
  }

  function showPage(name) {
    const page = $(`#page-${name}`);
    if (!page) return;
    $$('.page').forEach(p => p.classList.toggle('active-page', p === page));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $$('#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.page === name));

    if (name === 'inicio') refreshHome();
    if (name === 'progresso') loadProgress();
    if (name === 'meus-videos') loadMyVideos();
    if (name === 'agenda') loadAppointments();
    if (name === 'mensagens') loadContacts();
    if (name === 'perfil') loadProfilePage();
  }

  function applyRoleUI() {
    const isPatient = profile?.role === 'patient';
    $$('.patient-only').forEach(el => el.classList.toggle('hidden', !isPatient));
    $$('.therapist-only').forEach(el => el.classList.toggle('hidden', isPatient));
    $('#userBadge').textContent = profile?.name || 'Usuário';
    setAvatarElement($('#userInitials'), profile?.name, profile?.avatar_url || null);
    $('#homeGreeting').textContent = `Olá, ${(profile?.name || 'Usuário').split(' ')[0]}!`;
    showPage('inicio');
  }

  async function loadProfile() {
    if (!session?.user) return;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) throw error;
    profile = data;
    profile.avatar_url = await avatarUrl(profile.avatar_path);
  }

  async function setLoggedInState() {
    $('#landing').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#desktopNav').classList.remove('hidden');
    $('#mobileNav').classList.remove('hidden');
    $('#logoutBtn').classList.remove('hidden');
    $('#userMenuBtn').classList.remove('hidden');
    $('#notificationBtn').classList.remove('hidden');
    applyRoleUI();
    await Promise.allSettled([loadVideos(), loadTherapists(), loadAppointments(), loadContacts(), loadProgress(), loadProfilePage()]);
    setupRealtime();
    refreshHome();
  }

  async function setLoggedOutState() {
    await unsubscribeAll();
    session = null;
    profile = null;
    videos = [];
    appointments = [];
    contacts = [];
    selectedContact = null;
    $('#landing').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#desktopNav').classList.add('hidden');
    $('#mobileNav').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');
    $('#userMenuBtn').classList.add('hidden');
    $('#notificationBtn').classList.add('hidden');
    if (callDialog.open) callDialog.close();
  }

  async function bootstrap() {
    readPreferences();
    $('#todayChip').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    currentCalendar = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderCalendar();
    if (!configured) return;
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) {
      try {
        await loadProfile();
        await setLoggedInState();
      } catch (e) {
        console.error(e);
        toast('Não foi possível carregar seu perfil. Verifique o SQL do projeto.', true);
      }
    }
    sb.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      if (newSession) {
        try {
          await loadProfile();
          await setLoggedInState();
        } catch (e) {
          console.error(e);
          toast('Erro ao carregar perfil.', true);
        }
      } else {
        await setLoggedOutState();
      }
    });
  }

  async function signedUrl(bucket, path, seconds = 3600) {
    if (!path) return null;
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
    return error ? null : data.signedUrl;
  }

  // ---------------------- Vídeos e progresso ----------------------
  async function loadVideos() {
    if (!sb || !session) return;
    const { data, error } = await sb.from('videos').select('*').eq('active', true).order('created_at', { ascending: false });
    if (error) {
      toast('Erro ao carregar vídeos.', true);
      return;
    }
    videos = await Promise.all((data || []).map(async v => ({ ...v, url: await signedUrl('fisiolink-videos', v.storage_path) })));
    populateCategories();
    renderVideos();
    renderHomeExercises();
  }

  function populateCategories() {
    const select = $('#categoryFilter');
    const current = select.value;
    const cats = [...new Set(videos.map(v => v.category).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c => `<option>${escapeHtml(c)}</option>`).join('');
    select.value = cats.includes(current) ? current : '';
  }

  function exerciseThumb() {
    return '<div class="video-thumb"><span>▶</span></div>';
  }

  function renderVideos() {
    const q = ($('#videoSearch').value || '').trim().toLowerCase();
    const cat = $('#categoryFilter').value;
    const list = videos.filter(v => (!cat || v.category === cat) && (!q || `${v.title} ${v.description || ''} ${v.category || ''} ${v.body_area || ''} ${v.therapist_name || ''}`.toLowerCase().includes(q)));
    $('#videoEmpty').classList.toggle('hidden', list.length > 0);
    $('#videoGrid').innerHTML = list.map(v => `
      <article class="video-card">
        <div data-open-video="${v.id}">${exerciseThumb()}</div>
        <div class="video-body">
          <div class="chips"><span class="chip">${escapeHtml(v.category || 'Exercício')}</span><span class="chip">${escapeHtml(v.level || 'Leve')}</span></div>
          <h3>${escapeHtml(v.title)}</h3>
          <p>${escapeHtml((v.description || 'Conteúdo orientado pelo fisioterapeuta.').slice(0, 130))}</p>
          <div class="video-meta"><span>${v.duration_minutes || '—'} min</span><span>${escapeHtml(v.therapist_name || 'Fisioterapeuta')}</span></div>
          <button class="btn primary full" data-open-video="${v.id}">Assistir vídeo</button>
        </div>
      </article>`).join('');
  }

  function renderHomeExercises() {
    const list = videos.slice(0, 3);
    $('#homeExercises').innerHTML = list.length ? list.map(v => `
      <article class="mini-exercise" data-open-video="${v.id}">
        <div class="mini-exercise-thumb"><span>▶</span></div>
        <h4>${escapeHtml(v.title)}</h4>
        <small>${escapeHtml(v.category || 'Exercício')} · ${v.duration_minutes || '—'} min</small>
      </article>`).join('') : '<div class="empty">Ainda não há exercícios publicados.</div>';
  }

  async function openVideo(id) {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    selectedVideo = v;
    $('#videoPlayer').src = v.url || '';
    $('#videoDetailTitle').textContent = v.title;
    $('#videoDetailDescription').textContent = v.description || 'Sem descrição.';
    $('#videoDetailMeta').textContent = `${v.therapist_name || 'Fisioterapeuta'} · ${v.duration_minutes || '—'} min`;
    $('#videoDetailChips').innerHTML = `<span class="chip">${escapeHtml(v.category || 'Exercício')}</span><span class="chip">${escapeHtml(v.body_area || 'Corpo')}</span><span class="chip">${escapeHtml(v.level || 'Leve')}</span>`;
    videoDialog.showModal();
  }

  async function markComplete() {
    if (!selectedVideo || profile?.role !== 'patient') return;
    const payload = { patient_id: session.user.id, video_id: selectedVideo.id, completed: true, watched_at: new Date().toISOString() };
    const { error } = await sb.from('progress').upsert(payload, { onConflict: 'patient_id,video_id' });
    if (error) return toast('Não foi possível salvar o progresso.', true);
    toast('Exercício marcado como concluído.');
    await loadProgress();
    refreshHome();
  }

  async function loadProgress() {
    if (!sb || profile?.role !== 'patient') return [];
    const { data, error } = await sb.from('progress').select('video_id,watched_at,completed,videos(title,duration_minutes,therapist_name)').eq('patient_id', session.user.id).eq('completed', true).order('watched_at', { ascending: false });
    if (error) {
      toast('Erro ao carregar progresso.', true);
      return [];
    }
    progressRows = data || [];
    $('#completedCount').textContent = progressRows.length;
    $('#completedMinutes').textContent = progressRows.reduce((s, r) => s + (Number(r.videos?.duration_minutes) || 0), 0);
    $('#lastCompleted').textContent = progressRows[0]?.watched_at ? new Date(progressRows[0].watched_at).toLocaleDateString('pt-BR') : '—';
    $('#progressList').innerHTML = progressRows.length ? progressRows.map(r => `<div class="progress-item"><div><b>${escapeHtml(r.videos?.title || 'Vídeo')}</b><small>${escapeHtml(r.videos?.therapist_name || 'Fisioterapeuta')} · ${new Date(r.watched_at).toLocaleString('pt-BR')}</small></div><span class="chip">Concluído</span></div>`).join('') : '<div class="empty">Você ainda não marcou nenhum exercício como concluído.</div>';
    updateHomeProgress();
    return progressRows;
  }

  function updateHomeProgress() {
    if (profile?.role !== 'patient') return;
    const total = Math.max(videos.length, 1);
    const pct = Math.min(100, Math.round((progressRows.length / total) * 100));
    $('#homeProgressRing').style.setProperty('--progress', pct);
    $('#homeProgressPct').textContent = `${pct}%`;
    $('#homeProgressText').textContent = pct >= 75 ? 'Ótimo resultado!' : pct > 0 ? 'Você está evoluindo' : 'Comece hoje';
    $('#homeProgressCaption').textContent = progressRows.length ? `Você concluiu ${progressRows.length} de ${videos.length} exercícios disponíveis.` : 'Conclua um exercício para acompanhar sua evolução.';
  }

  function sanitizeFilename(name) {
    const clean = String(name || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-');
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
  }

  async function uploadVideo(e) {
    e.preventDefault();
    if (profile?.role !== 'therapist') return toast('Apenas fisioterapeutas podem publicar vídeos.', true);
    const file = $('#videoFile').files[0];
    if (!file) return toast('Escolha um vídeo.', true);
    if (!['video/mp4', 'video/webm'].includes(file.type)) return toast('Use um arquivo MP4 ou WebM.', true);
    if (file.size > 200 * 1024 * 1024) return toast('O vídeo deve ter no máximo 200 MB.', true);

    const status = $('#uploadStatus');
    status.classList.remove('hidden');
    status.textContent = 'Enviando vídeo... não feche esta página.';
    const path = `${session.user.id}/${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await sb.storage.from('fisiolink-videos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (uploadError) {
      status.classList.add('hidden');
      return toast(`Erro no upload: ${uploadError.message}`, true);
    }

    const row = {
      therapist_id: session.user.id,
      therapist_name: profile.name,
      title: $('#videoTitle').value.trim(),
      category: $('#videoCategory').value.trim(),
      body_area: $('#videoBodyArea').value.trim(),
      level: $('#videoLevel').value,
      duration_minutes: Number($('#videoDuration').value),
      description: $('#videoDescription').value.trim(),
      storage_path: path,
      active: true
    };
    const { error: dbError } = await sb.from('videos').insert(row);
    if (dbError) {
      await sb.storage.from('fisiolink-videos').remove([path]);
      status.classList.add('hidden');
      return toast(`Erro ao salvar vídeo: ${dbError.message}`, true);
    }
    $('#uploadForm').reset();
    $('#videoDuration').value = 8;
    status.textContent = 'Vídeo publicado com sucesso.';
    toast('Vídeo publicado. Os pacientes já podem visualizá-lo.');
    await loadVideos();
    setTimeout(() => status.classList.add('hidden'), 2500);
    showPage('meus-videos');
  }

  async function loadMyVideos() {
    if (!sb || profile?.role !== 'therapist') return;
    const { data, error } = await sb.from('videos').select('*').eq('therapist_id', session.user.id).order('created_at', { ascending: false });
    if (error) return toast('Erro ao carregar seus vídeos.', true);
    const own = data || [];
    $('#myVideosCount').textContent = own.length;
    $('#activeVideosCount').textContent = own.filter(v => v.active).length;
    const ids = own.map(v => v.id);
    let completions = 0;
    if (ids.length) {
      const { count } = await sb.from('progress').select('*', { count: 'exact', head: true }).in('video_id', ids).eq('completed', true);
      completions = count || 0;
    }
    $('#therapistCompletions').textContent = completions;
    $('#myVideosList').innerHTML = own.length ? own.map(v => `<div class="manage-item"><div><b>${escapeHtml(v.title)}</b><small>${escapeHtml(v.category || '')} · ${v.duration_minutes || '—'} min · ${v.active ? 'Ativo' : 'Oculto'}</small></div><div class="manage-actions"><button class="btn ghost" data-toggle-video="${v.id}" data-active="${v.active}">${v.active ? 'Ocultar' : 'Ativar'}</button><button class="btn ghost danger" data-delete-video="${v.id}" data-path="${encodeURIComponent(v.storage_path)}">Excluir</button></div></div>`).join('') : '<div class="empty">Você ainda não publicou nenhum vídeo.</div>';
  }

  async function toggleVideo(id, active) {
    const { error } = await sb.from('videos').update({ active: !active }).eq('id', id).eq('therapist_id', session.user.id);
    if (error) return toast('Não foi possível atualizar o vídeo.', true);
    toast(!active ? 'Vídeo ativado.' : 'Vídeo ocultado.');
    await Promise.all([loadMyVideos(), loadVideos()]);
  }

  async function deleteVideo(id, path) {
    if (!confirm('Excluir este vídeo permanentemente?')) return;
    const { error: storageError } = await sb.storage.from('fisiolink-videos').remove([path]);
    if (storageError) return toast(`Erro ao apagar arquivo: ${storageError.message}`, true);
    const { error } = await sb.from('videos').delete().eq('id', id).eq('therapist_id', session.user.id);
    if (error) return toast('Arquivo apagado, mas houve erro ao remover o registro.', true);
    toast('Vídeo excluído.');
    await Promise.all([loadMyVideos(), loadVideos()]);
  }

  // ---------------------- Agenda ----------------------
  async function loadTherapists() {
    if (!sb || !session) return;
    const { data, error } = await sb.from('profiles').select('id,name,role').eq('role', 'therapist').order('name');
    if (error) return;
    therapists = data || [];
    const select = $('#appointmentTherapist');
    select.innerHTML = therapists.length ? therapists.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('') : '<option value="">Nenhum fisioterapeuta disponível</option>';
  }

  async function loadAppointments() {
    if (!sb || !session) return;
    const uid = session.user.id;
    const { data, error } = await sb.from('appointments').select('*,patient:profiles!appointments_patient_id_fkey(name),therapist:profiles!appointments_therapist_id_fkey(name)').or(`patient_id.eq.${uid},therapist_id.eq.${uid}`).order('scheduled_at', { ascending: true });
    if (error) {
      if (String(error.message).toLowerCase().includes('appointments')) return;
      console.error(error);
      return;
    }
    appointments = data || [];
    renderAppointments();
    renderCalendar();
    updateNextAppointment();
  }

  function renderAppointments() {
    const now = new Date();
    const upcoming = appointments.filter(a => new Date(a.scheduled_at) >= new Date(now.getTime() - 86400000)).slice(0, 20);
    $('#appointmentsList').innerHTML = upcoming.length ? upcoming.map(a => {
      const d = new Date(a.scheduled_at);
      const other = profile?.role === 'patient' ? (a.therapist?.name || 'Fisioterapeuta') : (a.patient?.name || 'Paciente');
      const actions = profile?.role === 'therapist' && a.status === 'pendente'
        ? `<div class="appointment-actions"><button class="mini-btn" data-appointment-status="confirmada" data-appointment-id="${a.id}">Confirmar</button><button class="mini-btn" data-appointment-status="cancelada" data-appointment-id="${a.id}">Recusar</button></div>`
        : (a.status !== 'cancelada' ? `<div class="appointment-actions"><button class="mini-btn" data-appointment-status="cancelada" data-appointment-id="${a.id}">Cancelar</button></div>` : '');
      return `<article class="appointment-item"><div class="appointment-date"><b>${String(d.getDate()).padStart(2, '0')}</b><small>${d.toLocaleDateString('pt-BR', { month: 'short' })}</small></div><div><strong>${escapeHtml(other)}</strong><span>${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(a.mode || 'online')}</span><small>${escapeHtml(a.note || 'Sessão de acompanhamento')}</small></div><span class="status-pill status-${a.status}">${escapeHtml(a.status || 'pendente')}</span>${actions}</article>`;
    }).join('') : '<div class="empty">Nenhuma sessão agendada ainda.</div>';
  }

  async function submitAppointment(e) {
    e.preventDefault();
    if (profile?.role !== 'patient') return;
    const therapistId = $('#appointmentTherapist').value;
    if (!therapistId) return toast('Nenhum fisioterapeuta disponível.', true);
    const payload = {
      patient_id: session.user.id,
      therapist_id: therapistId,
      requested_by: session.user.id,
      scheduled_at: new Date($('#appointmentDate').value).toISOString(),
      mode: $('#appointmentMode').value,
      note: $('#appointmentNote').value.trim(),
      status: 'pendente'
    };
    const { error } = await sb.from('appointments').insert(payload);
    if (error) return toast(`Não foi possível solicitar a sessão: ${error.message}`, true);
    appointmentDialog.close();
    $('#appointmentForm').reset();
    toast('Solicitação enviada ao fisioterapeuta.');
    await loadAppointments();
  }

  async function updateAppointmentStatus(id, status) {
    const { error } = await sb.from('appointments').update({ status }).eq('id', id);
    if (error) return toast('Não foi possível atualizar a sessão.', true);
    toast(status === 'confirmada' ? 'Sessão confirmada.' : 'Sessão cancelada.');
    await loadAppointments();
  }

  function updateNextAppointment() {
    const next = appointments.find(a => ['pendente', 'confirmada'].includes(a.status) && new Date(a.scheduled_at) >= new Date());
    if (!next) {
      $('#nextAppointmentTitle').textContent = 'Nenhuma agendada';
      $('#nextAppointmentMeta').textContent = 'Use a agenda para solicitar um horário.';
      return;
    }
    const other = profile?.role === 'patient' ? next.therapist?.name : next.patient?.name;
    $('#nextAppointmentTitle').textContent = formatDateTime(next.scheduled_at);
    $('#nextAppointmentMeta').textContent = `${other || 'Atendimento'} · ${next.mode} · ${next.status}`;
  }

  function renderCalendar() {
    const title = $('#calendarTitle');
    const grid = $('#calendarGrid');
    if (!title || !grid) return;
    const year = currentCalendar.getFullYear();
    const month = currentCalendar.getMonth();
    title.textContent = currentCalendar.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const today = new Date();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const hasEvent = appointments.some(a => String(a.scheduled_at).slice(0, 10) === iso && a.status !== 'cancelada');
      const isToday = d.toDateString() === today.toDateString();
      const muted = d.getMonth() !== month;
      cells.push(`<button class="cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''} ${muted ? 'muted' : ''}" data-calendar-date="${iso}">${d.getDate()}</button>`);
    }
    grid.innerHTML = cells.join('');
  }

  // ---------------------- Contatos e mensagens ----------------------
  async function loadContacts() {
    if (!sb || !session || !profile) return;
    const targetRole = profile.role === 'patient' ? 'therapist' : 'patient';
    let { data, error } = await sb.from('profiles').select('id,name,role,avatar_path,specialty,city').eq('role', targetRole).neq('id', session.user.id).order('name');
    if (error) {
      const fallback = await sb.from('profiles').select('id,name,role').eq('role', targetRole).neq('id', session.user.id).order('name');
      data = fallback.data;
      error = fallback.error;
    }
    if (error) return;
    contacts = await Promise.all((data || []).map(async c => ({ ...c, avatar_url: await avatarUrl(c.avatar_path) })));
    $('#onlineCount').textContent = `${contacts.length} contato${contacts.length === 1 ? '' : 's'}`;
    renderContacts();
    if (selectedContact) {
      selectedContact = contacts.find(c => c.id === selectedContact.id) || null;
    }
  }

  function renderContacts() {
    const q = ($('#contactSearch').value || '').trim().toLowerCase();
    const list = contacts.filter(c => c.name.toLowerCase().includes(q));
    $('#contactsList').innerHTML = list.length ? list.map(c => {
      const avatarStyle = c.avatar_url ? ` style="background-image:url('${c.avatar_url}')" data-has-avatar="1"` : '';
      const subtitle = c.role === 'therapist' ? (c.specialty || 'Fisioterapeuta') : 'Paciente';
      return `<button class="contact-item ${selectedContact?.id === c.id ? 'active' : ''}" data-contact-id="${c.id}"><div class="avatar ${c.avatar_url ? 'has-avatar' : ''}"${avatarStyle}>${c.avatar_url ? '' : initials(c.name)}</div><div class="contact-copy"><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(subtitle)} · disponível</span></div><span>›</span></button>`;
    }).join('') : '<div class="empty">Nenhum contato encontrado.</div>';
  }

  async function selectContact(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;
    selectedContact = contact;
    renderContacts();
    $('#chatEmpty').classList.add('hidden');
    $('#chatActive').classList.remove('hidden');
    setAvatarElement($('#chatAvatar'), contact.name, contact.avatar_url);
    $('#chatName').textContent = contact.name;
    $('#chatRole').textContent = contact.role === 'therapist' ? (contact.specialty || 'Fisioterapeuta') : 'Paciente';
    $('.messages-shell').classList.add('chat-open');
    await loadMessages();
  }

  async function loadMessages() {
    if (!selectedContact || !sb) return;
    const uid = session.user.id;
    const cid = selectedContact.id;
    const { data, error } = await sb.from('messages').select('*').or(`and(sender_id.eq.${uid},receiver_id.eq.${cid}),and(sender_id.eq.${cid},receiver_id.eq.${uid})`).order('created_at', { ascending: true }).limit(250);
    if (error) {
      $('#messagesList').innerHTML = '<div class="empty">Para ativar mensagens, execute o arquivo <b>ATUALIZACAO-SUPABASE.sql</b> no Supabase.</div>';
      return;
    }
    await renderMessages(data || []);
  }

  async function renderMessages(rows) {
    const html = await Promise.all(rows.map(async m => {
      const mine = m.sender_id === session.user.id;
      let content = '';
      if (m.message_type === 'file' && m.attachment_path) {
        const url = await signedUrl('fisiolink-chat', m.attachment_path, 1800);
        content = url ? `<a class="msg-file" href="${url}" target="_blank" rel="noopener"><span class="msg-file-icon">⌕</span><span>${escapeHtml(m.attachment_name || 'Arquivo')}</span></a>` : '<p>Arquivo indisponível.</p>';
      } else if (m.message_type === 'audio' && m.attachment_path) {
        const url = await signedUrl('fisiolink-chat', m.attachment_path, 1800);
        content = url ? `<div class="msg-audio"><audio controls preload="metadata" src="${url}"></audio></div>` : '<p>Áudio indisponível.</p>';
      } else {
        content = `<p>${escapeHtml(m.body || '')}</p>`;
      }
      const person = mine ? profile : selectedContact;
      const avatarStyle = person?.avatar_url ? ` style="background-image:url('${person.avatar_url}')"` : '';
      return `<div class="msg-row ${mine ? 'mine' : 'theirs'}"><div class="msg-avatar ${person?.avatar_url ? 'has-avatar' : ''}"${avatarStyle}>${person?.avatar_url ? '' : initials(person?.name)}</div><div class="msg-bubble">${content}<div class="msg-meta"><span>${formatTime(m.created_at)}</span>${mine ? '<span>✓✓</span>' : ''}</div></div></div>`;
    }));
    const list = $('#messagesList');
    list.innerHTML = html.join('') || '<div class="empty">Comece a conversa por aqui.</div>';
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  async function sendTextMessage(e) {
    e.preventDefault();
    if (!selectedContact) return;
    const input = $('#messageInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    const { error } = await sb.from('messages').insert({ sender_id: session.user.id, receiver_id: selectedContact.id, body, message_type: 'text' });
    if (error) {
      input.value = body;
      return toast('Não foi possível enviar. Rode a atualização SQL do chat.', true);
    }
    await loadMessages();
  }

  async function sendAttachment(file, type = 'file') {
    if (!selectedContact || !file) return;
    if (file.size > 20 * 1024 * 1024) return toast('O arquivo deve ter no máximo 20 MB.', true);
    const path = `${session.user.id}/${sanitizeFilename(file.name || `${type}.webm`)}`;
    toast(type === 'audio' ? 'Enviando áudio...' : 'Enviando arquivo...');
    const { error: upError } = await sb.storage.from('fisiolink-chat').upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (upError) return toast(`Erro ao enviar arquivo: ${upError.message}`, true);
    const { error } = await sb.from('messages').insert({ sender_id: session.user.id, receiver_id: selectedContact.id, body: '', message_type: type, attachment_path: path, attachment_name: file.name || (type === 'audio' ? 'Mensagem de voz' : 'Arquivo') });
    if (error) {
      await sb.storage.from('fisiolink-chat').remove([path]);
      return toast('Não foi possível salvar a mensagem.', true);
    }
    toast(type === 'audio' ? 'Áudio enviado.' : 'Arquivo enviado.');
    await loadMessages();
  }

  async function startRecording() {
    if (!selectedContact) return toast('Escolha um contato primeiro.', true);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Seu navegador não suporta gravação de áudio.', true);
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      mediaRecorder = new MediaRecorder(recordingStream, { mimeType: mime });
      mediaRecorder.ondataavailable = e => { if (e.data.size) recordingChunks.push(e.data); };
      mediaRecorder.start();
      recordingStarted = Date.now();
      $('#recordingBar').classList.remove('hidden');
      recordingTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - recordingStarted) / 1000);
        $('#recordingTimer').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      }, 500);
    } catch (e) {
      toast('Não foi possível acessar o microfone.', true);
    }
  }

  async function stopRecording(send = true) {
    if (!mediaRecorder) return;
    const recorder = mediaRecorder;
    const done = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.stop();
    await done;
    clearInterval(recordingTimer);
    $('#recordingBar').classList.add('hidden');
    recordingStream?.getTracks().forEach(t => t.stop());
    recordingStream = null;
    mediaRecorder = null;
    if (!send) {
      recordingChunks = [];
      return;
    }
    const blob = new Blob(recordingChunks, { type: recorder.mimeType || 'audio/webm' });
    const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
    recordingChunks = [];
    await sendAttachment(file, 'audio');
  }

  function setupRealtime() {
    if (!sb || !session) return;
    if (messageChannel) sb.removeChannel(messageChannel);
    messageChannel = sb.channel(`messages-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new;
        if (![m.sender_id, m.receiver_id].includes(session.user.id)) return;
        if (selectedContact && [m.sender_id, m.receiver_id].includes(selectedContact.id)) loadMessages();
        if (m.sender_id !== session.user.id && localPreferences.messageAlerts) {
          $('#notificationDot').classList.remove('hidden');
          if (document.visibilityState !== 'visible') toast('Você recebeu uma nova mensagem.');
        }
      }).subscribe();

    if (callGlobalChannel) sb.removeChannel(callGlobalChannel);
    callGlobalChannel = sb.channel(`calls-global-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_sessions' }, payload => {
        const row = payload.new || payload.old;
        if (!row || ![row.caller_id, row.callee_id].includes(session.user.id)) return;
        if (row.callee_id === session.user.id && row.status === 'ringing' && !currentCall) showIncomingCall(row);
        if (currentCall?.id === row.id) handleCallUpdate(row);
      }).subscribe();

    clearInterval(incomingPoll);
    incomingPoll = setInterval(checkIncomingCalls, 4500);
    checkIncomingCalls();
  }

  // ---------------------- Ligações WebRTC ----------------------
  async function checkIncomingCalls() {
    if (!sb || !session || currentCall) return;
    const { data, error } = await sb.from('call_sessions').select('*').eq('callee_id', session.user.id).eq('status', 'ringing').order('created_at', { ascending: false }).limit(1);
    if (!error && data?.[0]) showIncomingCall(data[0]);
  }

  function setCallUi(row, incoming = false) {
    const otherId = row.caller_id === session.user.id ? row.callee_id : row.caller_id;
    const other = contacts.find(c => c.id === otherId) || (selectedContact?.id === otherId ? selectedContact : null);
    $('#callName').textContent = other?.name || 'Contato';
    setAvatarElement($('#callAvatar'), other?.name || 'FL', other?.avatar_url || null);
    $('#callTypeLabel').textContent = row.call_type === 'video' ? 'Chamada de vídeo' : 'Ligação de voz';
    $('#videoStage').classList.toggle('hidden', row.call_type !== 'video');
    $('#toggleCameraBtn').classList.toggle('hidden', row.call_type !== 'video');
    $('#acceptCallBtn').classList.toggle('hidden', !incoming);
    $('#declineCallBtn').classList.toggle('hidden', !incoming);
    $('#endCallBtn').classList.toggle('hidden', incoming);
    $('#callStatus').textContent = incoming ? 'Chamada recebida' : (row.status === 'accepted' ? 'Conectado' : 'Chamando...');
  }

  async function startCall(type) {
    if (!selectedContact) return toast('Escolha um contato primeiro.', true);
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Seu navegador não suporta chamadas pelo FisioLink.', true);
    try {
      currentCall = { caller_id: session.user.id, callee_id: selectedContact.id, call_type: type, status: 'preparing' };
      setCallUi(currentCall, false);
      callDialog.showModal();
      await prepareLocalMedia(type);
      const { data, error } = await sb.from('call_sessions').insert({ caller_id: session.user.id, callee_id: selectedContact.id, call_type: type, status: 'preparing' }).select().single();
      if (error) throw error;
      currentCall = data;
      await createPeerConnection(data.id);
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const { data: updated, error: updateError } = await sb.from('call_sessions').update({ offer: { type: offer.type, sdp: offer.sdp }, status: 'ringing' }).eq('id', data.id).select().single();
      if (updateError) throw updateError;
      currentCall = updated;
      setCallUi(currentCall, false);
      subscribeSpecificCall(data.id);
      startCallPolling();
    } catch (e) {
      console.error(e);
      toast(`Não foi possível iniciar a chamada: ${e.message || e}`, true);
      await cleanupCall(true, false);
    }
  }

  async function showIncomingCall(row) {
    if (currentCall) return;
    currentCall = row;
    setCallUi(row, true);
    if (!callDialog.open) callDialog.showModal();
    subscribeSpecificCall(row.id);
    startCallPolling();
  }

  async function acceptCall() {
    if (!currentCall || currentCall.callee_id !== session.user.id) return;
    try {
      await prepareLocalMedia(currentCall.call_type);
      await createPeerConnection(currentCall.id);
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
      if (!currentCall.offer) {
        const { data } = await sb.from('call_sessions').select('*').eq('id', currentCall.id).single();
        currentCall = data;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(currentCall.offer));
      remoteDescriptionSet = true;
      await flushPendingIce();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const { data, error } = await sb.from('call_sessions').update({ answer: { type: answer.type, sdp: answer.sdp }, status: 'accepted' }).eq('id', currentCall.id).select().single();
      if (error) throw error;
      currentCall = data;
      $('#acceptCallBtn').classList.add('hidden');
      $('#declineCallBtn').classList.add('hidden');
      $('#endCallBtn').classList.remove('hidden');
      $('#callStatus').textContent = 'Conectando...';
      startCallPolling();
    } catch (e) {
      console.error(e);
      toast('Não foi possível atender a chamada.', true);
      await endCall('ended');
    }
  }

  async function prepareLocalMedia(type) {
    localStream?.getTracks().forEach(t => t.stop());
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    $('#localVideo').srcObject = localStream;
  }

  async function createPeerConnection(callId) {
    if (peer) peer.close();
    remoteDescriptionSet = false;
    pendingIce = [];
    peer = new RTCPeerConnection(rtcConfig);
    remoteStream = new MediaStream();
    $('#remoteVideo').srcObject = remoteStream;
    $('#remoteAudio').srcObject = remoteStream;

    peer.ontrack = event => {
      event.streams[0]?.getTracks().forEach(track => {
        if (!remoteStream.getTracks().some(t => t.id === track.id)) remoteStream.addTrack(track);
      });
      $('#callStatus').textContent = 'Conectado';
    };
    peer.onicecandidate = async event => {
      if (!event.candidate || !currentCall?.id) return;
      await sb.from('ice_candidates').insert({ call_id: currentCall.id, user_id: session.user.id, candidate: event.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') $('#callStatus').textContent = 'Conectado';
      if (['failed', 'disconnected'].includes(peer.connectionState)) $('#callStatus').textContent = 'Reconectando...';
    };
    await loadExistingIce(callId);
  }

  async function loadExistingIce(callId) {
    const { data } = await sb.from('ice_candidates').select('*').eq('call_id', callId).neq('user_id', session.user.id).order('created_at', { ascending: true });
    for (const row of data || []) await addRemoteIce(row.candidate);
  }

  async function addRemoteIce(candidate) {
    if (!candidate) return;
    if (!peer || !remoteDescriptionSet) {
      pendingIce.push(candidate);
      return;
    }
    try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn('ICE', e); }
  }

  async function flushPendingIce() {
    const queue = [...pendingIce];
    pendingIce = [];
    for (const candidate of queue) await addRemoteIce(candidate);
  }

  function subscribeSpecificCall(callId) {
    if (callChannel) sb.removeChannel(callChannel);
    if (iceChannel) sb.removeChannel(iceChannel);
    callChannel = sb.channel(`call-${callId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` }, payload => handleCallUpdate(payload.new))
      .subscribe();
    iceChannel = sb.channel(`ice-${callId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ice_candidates', filter: `call_id=eq.${callId}` }, payload => {
        if (payload.new.user_id !== session.user.id) addRemoteIce(payload.new.candidate);
      }).subscribe();
  }

  async function handleCallUpdate(row) {
    if (!currentCall || currentCall.id !== row.id) return;
    currentCall = row;
    if (row.status === 'accepted') {
      $('#callStatus').textContent = 'Conectando...';
      if (row.caller_id === session.user.id && row.answer && peer && !remoteDescriptionSet) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(row.answer));
          remoteDescriptionSet = true;
          await flushPendingIce();
        } catch (e) { console.error(e); }
      }
    }
    if (['ended', 'declined'].includes(row.status)) {
      toast(row.status === 'declined' ? 'Chamada recusada.' : 'Chamada encerrada.');
      await cleanupCall(true, false);
    }
  }

  function startCallPolling() {
    clearInterval(callPoll);
    callPoll = setInterval(async () => {
      if (!currentCall?.id) return;
      const { data, error } = await sb.from('call_sessions').select('*').eq('id', currentCall.id).single();
      if (!error && data) handleCallUpdate(data);
    }, 1400);
  }

  async function declineCall() {
    if (!currentCall?.id) return;
    await sb.from('call_sessions').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', currentCall.id);
    await cleanupCall(true, false);
  }

  async function endCall(status = 'ended') {
    if (currentCall?.id) {
      await sb.from('call_sessions').update({ status, ended_at: new Date().toISOString() }).eq('id', currentCall.id);
    }
    await cleanupCall(true, false);
  }

  async function cleanupCall(closeDialog = true, notifyDb = false) {
    if (callCleanupInProgress) return;
    callCleanupInProgress = true;
    if (notifyDb && currentCall?.id) await sb.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', currentCall.id);
    clearInterval(callPoll);
    callPoll = null;
    localStream?.getTracks().forEach(t => t.stop());
    remoteStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    remoteStream = null;
    if (peer) peer.close();
    peer = null;
    $('#localVideo').srcObject = null;
    $('#remoteVideo').srcObject = null;
    $('#remoteAudio').srcObject = null;
    if (callChannel) { sb?.removeChannel(callChannel); callChannel = null; }
    if (iceChannel) { sb?.removeChannel(iceChannel); iceChannel = null; }
    currentCall = null;
    pendingIce = [];
    remoteDescriptionSet = false;
    if (closeDialog && callDialog.open) callDialog.close();
    callCleanupInProgress = false;
  }

  function toggleMute() {
    const audio = localStream?.getAudioTracks()?.[0];
    if (!audio) return;
    audio.enabled = !audio.enabled;
    $('#muteCallBtn').classList.toggle('muted', !audio.enabled);
    $('#muteCallBtn small').textContent = audio.enabled ? 'Microfone' : 'Mudo';
  }

  function toggleCamera() {
    const video = localStream?.getVideoTracks()?.[0];
    if (!video) return;
    video.enabled = !video.enabled;
    $('#toggleCameraBtn small').textContent = video.enabled ? 'Câmera' : 'Sem câmera';
  }

  // ---------------------- Home ----------------------
  function refreshHome() {
    renderHomeExercises();
    updateHomeProgress();
    updateNextAppointment();
  }

  // ---------------------- Auth ----------------------

  // ---------------------- Perfil, conta e preferências ----------------------
  function profileCompletion() {
    if (!profile) return 0;
    const common = [profile.name, profile.phone, profile.city, profile.bio, profile.avatar_path];
    const professional = profile.role === 'therapist' ? [profile.specialty, profile.crefito, profile.clinic] : [];
    const all = [...common, ...professional];
    const filled = all.filter(v => String(v || '').trim()).length;
    return all.length ? Math.round((filled / all.length) * 100) : 0;
  }

  async function loadProfileStats() {
    if (!sb || !session || !profile) return;
    const uid = session.user.id;
    let stat1 = 0, stat2 = 0, stat3 = 0;

    try {
      if (profile.role === 'patient') {
        const [{ count: progressCount }, { count: appointmentCount }, { count: messageCount }] = await Promise.all([
          sb.from('progress').select('id', { count: 'exact', head: true }).eq('patient_id', uid).eq('completed', true),
          sb.from('appointments').select('id', { count: 'exact', head: true }).or(`patient_id.eq.${uid},therapist_id.eq.${uid}`),
          sb.from('messages').select('id', { count: 'exact', head: true }).or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        ]);
        stat1 = progressCount || 0;
        stat2 = appointmentCount || 0;
        stat3 = messageCount || 0;
        $('#profileStat1Label').textContent = 'Exercícios concluídos';
        $('#profileStat2Label').textContent = 'Sessões';
        $('#profileStat3Label').textContent = 'Mensagens';
      } else {
        const [{ count: videoCount }, { count: appointmentCount }, { count: messageCount }] = await Promise.all([
          sb.from('videos').select('id', { count: 'exact', head: true }).eq('therapist_id', uid),
          sb.from('appointments').select('id', { count: 'exact', head: true }).or(`patient_id.eq.${uid},therapist_id.eq.${uid}`),
          sb.from('messages').select('id', { count: 'exact', head: true }).or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        ]);
        stat1 = videoCount || 0;
        stat2 = appointmentCount || 0;
        stat3 = messageCount || 0;
        $('#profileStat1Label').textContent = 'Vídeos publicados';
        $('#profileStat2Label').textContent = 'Sessões';
        $('#profileStat3Label').textContent = 'Mensagens';
      }
    } catch (e) {
      console.warn('Resumo do perfil indisponível', e);
    }

    $('#profileStat1').textContent = stat1;
    $('#profileStat2').textContent = stat2;
    $('#profileStat3').textContent = stat3;
  }

  async function loadProfilePage() {
    if (!profile || !session) return;
    setAvatarElement($('#profileAvatar'), profile.name, profile.avatar_url);
    $('#profileDisplayName').textContent = profile.name || 'Usuário FisioLink';
    $('#profileRoleBadge').textContent = profile.role === 'therapist' ? 'Fisioterapeuta' : 'Paciente';
    $('#profileEmail').value = session.user.email || '';
    $('#profileName').value = profile.name || '';
    $('#profilePhone').value = profile.phone || '';
    $('#profileCity').value = profile.city || '';
    $('#profileBio').value = profile.bio || '';
    $('#profileSpecialty').value = profile.specialty || '';
    $('#profileCrefito').value = profile.crefito || '';
    $('#profileClinic').value = profile.clinic || '';
    const created = profile.created_at ? new Date(profile.created_at) : null;
    $('#profileMemberSince').textContent = created && !Number.isNaN(created.getTime())
      ? `Membro desde ${created.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
      : 'Conta FisioLink';
    const pct = profileCompletion();
    $('#profileCompletionLabel').textContent = `${pct}%`;
    $('#profileCompletionBar').style.width = `${pct}%`;
    applyPreferences();
    await loadProfileStats();
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!sb || !session || !profile) return;
    const payload = {
      name: $('#profileName').value.trim(),
      phone: $('#profilePhone').value.trim(),
      city: $('#profileCity').value.trim(),
      bio: $('#profileBio').value.trim(),
      specialty: profile.role === 'therapist' ? $('#profileSpecialty').value.trim() : null,
      crefito: profile.role === 'therapist' ? $('#profileCrefito').value.trim() : null,
      clinic: profile.role === 'therapist' ? $('#profileClinic').value.trim() : null,
      updated_at: new Date().toISOString()
    };
    if (!payload.name) return toast('Informe seu nome.', true);
    $('#profileSaveStatus').textContent = 'Salvando...';
    const { data, error } = await sb.from('profiles').update(payload).eq('id', session.user.id).select('*').single();
    if (error) {
      $('#profileSaveStatus').textContent = '';
      return toast('Não foi possível salvar. Execute a atualização SQL de perfil no Supabase.', true);
    }
    profile = { ...profile, ...data };
    profile.avatar_url = await avatarUrl(profile.avatar_path);
    $('#profileSaveStatus').textContent = 'Alterações salvas ✓';
    setTimeout(() => { if ($('#profileSaveStatus')) $('#profileSaveStatus').textContent = ''; }, 2600);
    $('#userBadge').textContent = profile.name;
    setAvatarElement($('#userInitials'), profile.name, profile.avatar_url);
    $('#homeGreeting').textContent = `Olá, ${(profile.name || 'Usuário').split(' ')[0]}!`;
    await loadProfilePage();
    await loadContacts();
    toast('Perfil atualizado.');
  }

  async function uploadProfileAvatar(file) {
    if (!file || !sb || !session || !profile) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return toast('Use uma imagem JPG, PNG ou WebP.', true);
    if (file.size > 5 * 1024 * 1024) return toast('A foto deve ter no máximo 5 MB.', true);

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${session.user.id}/avatar-${Date.now()}.${ext}`;
    toast('Enviando foto...');
    const { error: uploadError } = await sb.storage.from('fisiolink-avatars').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return toast('Não foi possível enviar a foto. Execute a atualização SQL de perfil.', true);

    const oldPath = profile.avatar_path;
    const { data, error } = await sb.from('profiles').update({ avatar_path: path, updated_at: new Date().toISOString() }).eq('id', session.user.id).select('*').single();
    if (error) {
      await sb.storage.from('fisiolink-avatars').remove([path]);
      return toast('Não foi possível associar a foto ao perfil.', true);
    }

    profile = { ...profile, ...data };
    profile.avatar_url = await avatarUrl(path);
    if (oldPath && oldPath !== path) await sb.storage.from('fisiolink-avatars').remove([oldPath]);
    setAvatarElement($('#profileAvatar'), profile.name, profile.avatar_url);
    setAvatarElement($('#userInitials'), profile.name, profile.avatar_url);
    await loadProfilePage();
    toast('Foto de perfil atualizada.');
  }

  function bindPreference(id, key) {
    const el = $(`#${id}`);
    if (!el) return;
    el.onchange = () => {
      localPreferences[key] = el.checked;
      savePreferences();
      toast('Preferência atualizada.');
    };
  }

  async function login(e) {
    e.preventDefault();
    if (!configured) return toast('O Supabase ainda não está configurado.', true);
    const { error } = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
    if (error) return toast(error.message, true);
    authDialog.close();
    $('#loginForm').reset();
  }

  async function register(e) {
    e.preventDefault();
    if (!configured) return toast('O Supabase ainda não está configurado.', true);
    const name = $('#registerName').value.trim();
    const role = $('#registerRole').value;
    const { data, error } = await sb.auth.signUp({ email: $('#registerEmail').value.trim(), password: $('#registerPassword').value, options: { data: { name, role } } });
    if (error) return toast(error.message, true);
    toast(data.session ? 'Conta criada com sucesso.' : 'Conta criada. Se necessário, confirme o e-mail para entrar.');
    authDialog.close();
    $('#registerForm').reset();
  }

  async function unsubscribeAll() {
    clearInterval(incomingPoll); incomingPoll = null;
    clearInterval(callPoll); callPoll = null;
    if (messageChannel) { sb?.removeChannel(messageChannel); messageChannel = null; }
    if (callGlobalChannel) { sb?.removeChannel(callGlobalChannel); callGlobalChannel = null; }
    if (callChannel) { sb?.removeChannel(callChannel); callChannel = null; }
    if (iceChannel) { sb?.removeChannel(iceChannel); iceChannel = null; }
    await cleanupCall(true, false);
  }

  // ---------------------- Eventos ----------------------
  $('#openLogin').onclick = () => { switchAuth('login'); authDialog.showModal(); };
  $('#openRegister').onclick = () => { switchAuth('register'); authDialog.showModal(); };
  $('#closeAuth').onclick = () => authDialog.close();
  $('#showRegister').onclick = () => switchAuth('register');
  $('#showLogin').onclick = () => switchAuth('login');
  $('#loginForm').onsubmit = login;
  $('#registerForm').onsubmit = register;
  $('#logoutBtn').onclick = async () => { if (sb) await sb.auth.signOut(); };
  $('#brandBtn').onclick = () => session ? showPage('inicio') : window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#notificationBtn').onclick = () => { $('#notificationDot').classList.add('hidden'); showPage('mensagens'); };
  $('#userMenuBtn').onclick = () => showPage('perfil');
  $('#profileForm').onsubmit = saveProfile;
  $('#changeAvatarBtn').onclick = () => $('#profileAvatarInput').click();
  $('#profileAvatarInput').onchange = async e => {
    const file = e.target.files?.[0];
    if (file) await uploadProfileAvatar(file);
    e.target.value = '';
  };
  $('#copyUserIdBtn').onclick = async () => {
    if (!session?.user?.id) return;
    try {
      await navigator.clipboard.writeText(session.user.id);
      toast('ID da conta copiado.');
    } catch (_) {
      toast(`ID: ${session.user.id}`);
    }
  };
  $('#profileLogoutBtn').onclick = async () => { if (sb) await sb.auth.signOut(); };
  bindPreference('prefLargeText', 'largeText');
  bindPreference('prefHighContrast', 'highContrast');
  bindPreference('prefReducedMotion', 'reducedMotion');
  bindPreference('prefMessageAlerts', 'messageAlerts');
  bindPreference('prefAppointmentAlerts', 'appointmentAlerts');

  $$('.nav-btn').forEach(b => b.onclick = () => showPage(b.dataset.page));
  $$('#mobileNav button').forEach(b => b.onclick = () => showPage(b.dataset.page));
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) showPage(go.dataset.go);
    const open = e.target.closest('[data-open-video]');
    if (open) openVideo(open.dataset.openVideo);
  });

  $('#uploadForm').onsubmit = uploadVideo;
  $('#videoSearch').oninput = renderVideos;
  $('#categoryFilter').onchange = renderVideos;
  $('#markCompleteBtn').onclick = markComplete;
  $$('[data-close-video]').forEach(b => b.onclick = () => videoDialog.close());
  videoDialog.addEventListener('close', () => { $('#videoPlayer').pause(); $('#videoPlayer').removeAttribute('src'); $('#videoPlayer').load(); selectedVideo = null; });
  $('#myVideosList').onclick = e => {
    const toggle = e.target.closest('[data-toggle-video]');
    if (toggle) return toggleVideo(toggle.dataset.toggleVideo, toggle.dataset.active === 'true');
    const del = e.target.closest('[data-delete-video]');
    if (del) return deleteVideo(del.dataset.deleteVideo, decodeURIComponent(del.dataset.path));
  };

  $('#openAppointmentBtn').onclick = () => appointmentDialog.showModal();
  $('#closeAppointment').onclick = () => appointmentDialog.close();
  $('#appointmentForm').onsubmit = submitAppointment;
  $('#quickSchedule').onclick = () => {
    if (selectedContact?.role === 'therapist') $('#appointmentTherapist').value = selectedContact.id;
    appointmentDialog.showModal();
  };
  $('#prevMonth').onclick = () => { currentCalendar = new Date(currentCalendar.getFullYear(), currentCalendar.getMonth() - 1, 1); renderCalendar(); };
  $('#nextMonth').onclick = () => { currentCalendar = new Date(currentCalendar.getFullYear(), currentCalendar.getMonth() + 1, 1); renderCalendar(); };
  $('#appointmentsList').onclick = e => {
    const btn = e.target.closest('[data-appointment-status]');
    if (btn) updateAppointmentStatus(btn.dataset.appointmentId, btn.dataset.appointmentStatus);
  };

  $('#contactSearch').oninput = renderContacts;
  $('#contactsList').onclick = e => {
    const item = e.target.closest('[data-contact-id]');
    if (item) selectContact(item.dataset.contactId);
  };
  $('#mobileBackContacts').onclick = () => $('.messages-shell').classList.remove('chat-open');
  $('#messageForm').onsubmit = sendTextMessage;
  $('#attachBtn').onclick = () => $('#chatFileInput').click();
  $('#quickFile').onclick = () => $('#chatFileInput').click();
  $('#chatFileInput').onchange = async e => {
    const file = e.target.files[0];
    if (file) await sendAttachment(file, 'file');
    e.target.value = '';
  };
  $('#recordBtn').onclick = startRecording;
  $('#stopRecording').onclick = () => stopRecording(true);
  $('#cancelRecording').onclick = () => stopRecording(false);
  $('#quickMore').onclick = () => toast('Você também pode enviar áudio, arquivos e fazer chamadas por voz ou vídeo.');
  $('#messageInput').addEventListener('input', e => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 110)}px`;
  });

  $('#voiceCallBtn').onclick = () => startCall('voice');
  $('#videoCallBtn').onclick = () => startCall('video');
  $('#acceptCallBtn').onclick = acceptCall;
  $('#declineCallBtn').onclick = declineCall;
  $('#endCallBtn').onclick = () => endCall('ended');
  $('#muteCallBtn').onclick = toggleMute;
  $('#toggleCameraBtn').onclick = toggleCamera;
  callDialog.addEventListener('cancel', e => { e.preventDefault(); if (currentCall) endCall('ended'); });

  // Estado visual inicial
  $$('.page').forEach(p => p.classList.toggle('active-page', p.id === 'page-inicio'));
  bootstrap();
})();
