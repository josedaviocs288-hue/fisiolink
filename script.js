(() => {
  const cfg = window.FISIOLINK_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('COLE_AQUI') && !cfg.SUPABASE_ANON_KEY.includes('COLE_AQUI');
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const toastEl = $('#toast');
  const toast = (msg, error=false) => { toastEl.textContent = msg; toastEl.classList.toggle('error', error); toastEl.classList.add('show'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>toastEl.classList.remove('show'),3200); };

  let sb = null;
  let session = null;
  let profile = null;
  let videos = [];
  let selectedVideo = null;

  if (!configured) {
    $('#setupWarning').classList.remove('hidden');
  } else {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  const authDialog = $('#authDialog');
  const videoDialog = $('#videoDialog');

  function switchAuth(mode) {
    $('#loginPanel').classList.toggle('hidden', mode !== 'login');
    $('#registerPanel').classList.toggle('hidden', mode !== 'register');
  }

  function showPage(name) {
    $$('.page').forEach(p => p.classList.toggle('active-page', p.id === `page-${name}`));
    $$('.page').forEach(p => p.style.display = p.classList.contains('active-page') ? 'block' : 'none');
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    if (name === 'progresso') loadProgress();
    if (name === 'meus-videos') loadMyVideos();
  }

  function applyRoleUI() {
    const isPatient = profile?.role === 'patient';
    $$('.patient-only').forEach(el => el.classList.toggle('hidden', !isPatient));
    $$('.therapist-only').forEach(el => el.classList.toggle('hidden', isPatient));
    $('#userBadge').textContent = `${profile?.name || 'Usuário'} · ${isPatient ? 'Paciente' : 'Fisioterapeuta'}`;
    showPage('videos');
  }

  async function loadProfile() {
    if (!session?.user) return;
    const { data, error } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single();
    if (error) throw error;
    profile = data;
  }

  async function setLoggedInState() {
    $('#landing').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#appNav').classList.remove('hidden');
    $('#logoutBtn').classList.remove('hidden');
    $('#userBadge').classList.remove('hidden');
    applyRoleUI();
    await loadVideos();
  }

  function setLoggedOutState() {
    session = null; profile = null; videos = [];
    $('#landing').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#appNav').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');
    $('#userBadge').classList.add('hidden');
  }

  async function bootstrap() {
    if (!configured) return;
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) {
      try { await loadProfile(); await setLoggedInState(); }
      catch (e) { console.error(e); toast('Não foi possível carregar seu perfil. Rode o SQL de configuração do projeto.', true); }
    }
    sb.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      if (newSession) {
        try { await loadProfile(); await setLoggedInState(); }
        catch (e) { console.error(e); toast('Erro ao carregar perfil.', true); }
      } else setLoggedOutState();
    });
  }

  async function signedUrl(path) {
    const { data, error } = await sb.storage.from('fisiolink-videos').createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }

  async function loadVideos() {
    if (!sb || !session) return;
    const { data, error } = await sb.from('videos').select('*').eq('active', true).order('created_at', { ascending:false });
    if (error) { toast('Erro ao carregar vídeos.', true); return; }
    videos = await Promise.all((data || []).map(async v => ({...v, url: await signedUrl(v.storage_path)})));
    populateCategories();
    renderVideos();
  }

  function populateCategories() {
    const current = $('#categoryFilter').value;
    const cats = [...new Set(videos.map(v => v.category).filter(Boolean))].sort();
    $('#categoryFilter').innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c => `<option>${escapeHtml(c)}</option>`).join('');
    $('#categoryFilter').value = cats.includes(current) ? current : '';
  }

  function renderVideos() {
    const q = ($('#videoSearch').value || '').trim().toLowerCase();
    const cat = $('#categoryFilter').value;
    const list = videos.filter(v => (!cat || v.category === cat) && (!q || `${v.title} ${v.description||''} ${v.category||''} ${v.body_area||''} ${v.therapist_name||''}`.toLowerCase().includes(q)));
    $('#videoEmpty').classList.toggle('hidden', list.length > 0);
    $('#videoGrid').innerHTML = list.map(v => `
      <article class="video-card">
        <div class="video-thumb" data-open-video="${v.id}">▶</div>
        <div class="video-body">
          <div class="chips"><span class="chip">${escapeHtml(v.category || 'Exercício')}</span><span class="chip">${escapeHtml(v.level || 'Leve')}</span></div>
          <h3>${escapeHtml(v.title)}</h3>
          <p>${escapeHtml((v.description || 'Sem descrição.').slice(0,130))}</p>
          <div class="video-meta"><span>${v.duration_minutes || '—'} min</span><span>${escapeHtml(v.therapist_name || 'Fisioterapeuta')}</span></div>
          <button class="btn primary full" data-open-video="${v.id}">Assistir</button>
        </div>
      </article>`).join('');
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
    const payload = { patient_id: session.user.id, video_id: selectedVideo.id, completed:true, watched_at:new Date().toISOString() };
    const { error } = await sb.from('progress').upsert(payload, { onConflict:'patient_id,video_id' });
    if (error) { toast('Não foi possível salvar o progresso.', true); return; }
    toast('Vídeo marcado como concluído.');
    await loadProgress();
  }

  async function loadProgress() {
    if (!sb || profile?.role !== 'patient') return;
    const { data, error } = await sb.from('progress').select('video_id,watched_at,completed,videos(title,duration_minutes,therapist_name)').eq('patient_id', session.user.id).eq('completed', true).order('watched_at',{ascending:false});
    if (error) { toast('Erro ao carregar progresso.', true); return; }
    const rows = data || [];
    $('#completedCount').textContent = rows.length;
    $('#completedMinutes').textContent = rows.reduce((s,r)=>s+(Number(r.videos?.duration_minutes)||0),0);
    $('#lastCompleted').textContent = rows[0]?.watched_at ? new Date(rows[0].watched_at).toLocaleDateString('pt-BR') : '—';
    $('#progressList').innerHTML = rows.length ? rows.map(r=>`<div class="progress-item"><div><b>${escapeHtml(r.videos?.title || 'Vídeo')}</b><small>${escapeHtml(r.videos?.therapist_name || 'Fisioterapeuta')} · ${new Date(r.watched_at).toLocaleString('pt-BR')}</small></div><span class="chip">Concluído</span></div>`).join('') : '<div class="empty">Você ainda não marcou nenhum vídeo como concluído.</div>';
  }

  function sanitizeFilename(name) {
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') : '';
    return `video-${Date.now()}-${Math.random().toString(36).slice(2,9)}${ext}`;
  }

  async function uploadVideo(e) {
    e.preventDefault();
    if (profile?.role !== 'therapist') return toast('Apenas fisioterapeutas podem publicar vídeos.', true);
    const file = $('#videoFile').files[0];
    if (!file) return toast('Escolha um vídeo.', true);
    if (!['video/mp4','video/webm'].includes(file.type)) return toast('Use um arquivo MP4 ou WebM.', true);
    if (file.size > 200 * 1024 * 1024) return toast('O vídeo deve ter no máximo 200 MB.', true);

    const status = $('#uploadStatus');
    status.classList.remove('hidden');
    status.textContent = 'Enviando vídeo... não feche esta página.';
    const path = `${session.user.id}/${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await sb.storage.from('fisiolink-videos').upload(path, file, { cacheControl:'3600', upsert:false, contentType:file.type });
    if (uploadError) { status.classList.add('hidden'); toast(`Erro no upload: ${uploadError.message}`, true); return; }

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
      status.classList.add('hidden'); toast(`Erro ao salvar vídeo: ${dbError.message}`, true); return;
    }
    $('#uploadForm').reset(); $('#videoDuration').value = 8;
    status.textContent = 'Vídeo publicado com sucesso.';
    toast('Vídeo publicado. Os pacientes já podem visualizá-lo.');
    await loadVideos();
    setTimeout(()=>status.classList.add('hidden'),2500);
    showPage('meus-videos');
  }

  async function loadMyVideos() {
    if (!sb || profile?.role !== 'therapist') return;
    const { data, error } = await sb.from('videos').select('*').eq('therapist_id', session.user.id).order('created_at',{ascending:false});
    if (error) { toast('Erro ao carregar seus vídeos.', true); return; }
    const own = data || [];
    $('#myVideosCount').textContent = own.length;
    $('#activeVideosCount').textContent = own.filter(v=>v.active).length;
    const ids = own.map(v=>v.id);
    let completions = 0;
    if (ids.length) {
      const { count } = await sb.from('progress').select('*', { count:'exact', head:true }).in('video_id', ids).eq('completed', true);
      completions = count || 0;
    }
    $('#therapistCompletions').textContent = completions;
    $('#myVideosList').innerHTML = own.length ? own.map(v=>`<div class="manage-item"><div><b>${escapeHtml(v.title)}</b><small>${escapeHtml(v.category || '')} · ${v.duration_minutes || '—'} min · ${v.active ? 'Ativo' : 'Oculto'}</small></div><div class="manage-actions"><button class="btn ghost" data-toggle-video="${v.id}" data-active="${v.active}">${v.active?'Ocultar':'Ativar'}</button><button class="btn ghost danger" data-delete-video="${v.id}" data-path="${encodeURIComponent(v.storage_path)}">Excluir</button></div></div>`).join('') : '<div class="empty">Você ainda não publicou nenhum vídeo.</div>';
  }

  async function toggleVideo(id, active) {
    const { error } = await sb.from('videos').update({active: !active}).eq('id', id).eq('therapist_id', session.user.id);
    if (error) return toast('Não foi possível atualizar o vídeo.', true);
    toast(!active ? 'Vídeo ativado.' : 'Vídeo ocultado.');
    await loadMyVideos(); await loadVideos();
  }

  async function deleteVideo(id, path) {
    if (!confirm('Excluir este vídeo permanentemente?')) return;
    const { error: storageError } = await sb.storage.from('fisiolink-videos').remove([path]);
    if (storageError) return toast(`Erro ao apagar arquivo: ${storageError.message}`, true);
    const { error } = await sb.from('videos').delete().eq('id', id).eq('therapist_id', session.user.id);
    if (error) return toast('Arquivo apagado, mas houve erro ao remover o registro.', true);
    toast('Vídeo excluído.');
    await loadMyVideos(); await loadVideos();
  }

  async function login(e) {
    e.preventDefault();
    if (!configured) return toast('Configure o Supabase primeiro.', true);
    const { error } = await sb.auth.signInWithPassword({ email:$('#loginEmail').value.trim(), password:$('#loginPassword').value });
    if (error) return toast(error.message, true);
    authDialog.close(); $('#loginForm').reset();
  }

  async function register(e) {
    e.preventDefault();
    if (!configured) return toast('Configure o Supabase primeiro.', true);
    const name = $('#registerName').value.trim();
    const role = $('#registerRole').value;
    const { data, error } = await sb.auth.signUp({
      email: $('#registerEmail').value.trim(),
      password: $('#registerPassword').value,
      options: { data: { name, role } }
    });
    if (error) return toast(error.message, true);
    if (!data.session) toast('Conta criada. Confirme o e-mail antes de entrar.');
    else toast('Conta criada com sucesso.');
    authDialog.close(); $('#registerForm').reset();
  }

  function escapeHtml(value='') {
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  $('#openLogin').onclick = () => { switchAuth('login'); authDialog.showModal(); };
  $('#closeAuth').onclick = () => authDialog.close();
  $('#openRegister').onclick = () => { switchAuth('register'); authDialog.showModal(); };
  $('#showRegister').onclick = () => switchAuth('register');
  $('#showLogin').onclick = () => switchAuth('login');
  $('#loginForm').onsubmit = login;
  $('#registerForm').onsubmit = register;
  $('#logoutBtn').onclick = async () => { if (sb) await sb.auth.signOut(); };
  $('#uploadForm').onsubmit = uploadVideo;
  $('#videoSearch').oninput = renderVideos;
  $('#categoryFilter').onchange = renderVideos;
  $('#videoGrid').onclick = e => { const btn=e.target.closest('[data-open-video]'); if(btn) openVideo(btn.dataset.openVideo); };
  $('#markCompleteBtn').onclick = markComplete;
  $$('[data-close-video]').forEach(b=>b.onclick=()=>videoDialog.close());
  videoDialog.addEventListener('close',()=>{ $('#videoPlayer').pause(); $('#videoPlayer').removeAttribute('src'); $('#videoPlayer').load(); selectedVideo=null; });
  $$('.nav-btn').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $('#myVideosList').onclick = e => {
    const toggle=e.target.closest('[data-toggle-video]');
    if(toggle) return toggleVideo(toggle.dataset.toggleVideo, toggle.dataset.active==='true');
    const del=e.target.closest('[data-delete-video]');
    if(del) return deleteVideo(del.dataset.deleteVideo, decodeURIComponent(del.dataset.path));
  };

  // Estado inicial
  $$('.page').forEach(p => p.style.display = p.id === 'page-videos' ? 'block' : 'none');
  bootstrap();
})();
