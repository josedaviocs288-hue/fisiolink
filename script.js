const exercises = [
  {id:1,title:'Mobilidade de ombro',region:'Ombro',level:'Leve',minutes:8,icon:'🙆',desc:'Movimentos suaves para lembrar a mobilidade orientada do ombro.',steps:['Sente-se ou fique em pé de forma confortável.','Realize o movimento somente dentro do limite orientado pelo profissional.','Mantenha respiração tranquila e evite compensações.','Interrompa se surgir piora importante da dor, tontura ou mal-estar.']},
  {id:2,title:'Alongamento lombar leve',region:'Coluna',level:'Leve',minutes:7,icon:'🧘',desc:'Sequência simples de mobilidade e alongamento para a região lombar.',steps:['Escolha uma superfície estável.','Faça o movimento de forma lenta.','Não force amplitude nem permaneça em posição dolorosa.','Use apenas se esse exercício fizer parte da sua orientação.']},
  {id:3,title:'Fortalecimento de joelho',region:'Joelho',level:'Moderado',minutes:12,icon:'🦵',desc:'Exercício demonstrativo de controle e fortalecimento do joelho.',steps:['Posicione-se próximo de um apoio seguro.','Mantenha o joelho alinhado conforme orientação recebida.','Faça as repetições sem pressa.','Pare em caso de dor intensa ou instabilidade.']},
  {id:4,title:'Mobilidade de quadril',region:'Quadril',level:'Leve',minutes:9,icon:'🚶',desc:'Rotina curta de mobilidade para quadril e região pélvica.',steps:['Comece com movimentos pequenos.','Mantenha tronco estável.','Aumente amplitude apenas se isso tiver sido orientado.','Registre como você se sentiu após a sessão.']},
  {id:5,title:'Controle de tornozelo',region:'Tornozelo',level:'Moderado',minutes:10,icon:'🦶',desc:'Prática demonstrativa de controle do tornozelo e apoio.',steps:['Use apoio próximo se houver risco de desequilíbrio.','Realize os movimentos devagar.','Evite treinar sobre superfície escorregadia.','Siga o número de repetições definido pelo profissional.']},
  {id:6,title:'Postura e mobilidade cervical',region:'Coluna',level:'Leve',minutes:6,icon:'🧍',desc:'Movimentos suaves para rotina de postura e mobilidade cervical.',steps:['Sente-se com apoio confortável.','Movimente o pescoço lentamente.','Não force rotação ou inclinação.','Procure avaliação se houver sintomas persistentes ou piora importante.']}
];

const professionals = [
  {name:'Dra. Marina Alves',specialty:'Ortopedia e reabilitação',type:'Fisioterapeuta',city:'Centro',distance:1.2,rating:'4,9',initials:'MA'},
  {name:'Clínica Movimento+',specialty:'Fisioterapia geral e idosos',type:'Clínica',city:'Centro',distance:2.4,rating:'4,8',initials:'M+'},
  {name:'Dr. Rafael Lima',specialty:'Esportiva e prevenção',type:'Fisioterapeuta',city:'Bairro Universitário',distance:3.1,rating:'4,9',initials:'RL'},
  {name:'Espaço Reabilitar',specialty:'Dor, mobilidade e pós-operatório',type:'Clínica',city:'Avenida Central',distance:4.3,rating:'4,7',initials:'ER'},
  {name:'Dra. Camila Rocha',specialty:'Geriatria e equilíbrio',type:'Fisioterapeuta',city:'Centro',distance:5.1,rating:'5,0',initials:'CR'},
  {name:'FisioViva',specialty:'Ortopedia e pilates clínico',type:'Clínica',city:'Zona Sul',distance:6.0,rating:'4,8',initials:'FV'}
];

const tips = {
  pausas:{title:'Pausas no dia a dia',text:'Tente alternar posições durante tarefas prolongadas. Pequenas pausas podem ajudar no conforto, mas não existe uma postura única ideal para todas as pessoas.'},
  retorno:{title:'Retorno gradual à atividade',text:'A progressão de esforço costuma ser feita de maneira gradual. Se você está retornando após lesão ou afastamento, siga a orientação do profissional que acompanha seu caso.'},
  recuperacao:{title:'Recuperação também importa',text:'Sono adequado, alimentação e descanso fazem parte do cuidado geral com a saúde. O FisioLink registra rotina, mas não substitui avaliação clínica.'},
  ajuda:{title:'Quando procurar avaliação',text:'Dor persistente, piora importante, perda de força, quedas, limitação crescente ou sintomas que preocupam você merecem avaliação profissional. Em situações urgentes, procure atendimento de emergência.'}
};

let currentProfile = null;
let currentProfessional = null;

const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const toast = msg => { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>t.classList.remove('show'),2500); };

function openModal(id){ const el=$(id); if(el && !el.open) el.showModal(); }
function closeModals(){ $$('dialog[open]').forEach(d=>d.close()); }

function showView(id){
  $$('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderExercises(){
  const region=$('#filtroRegiao').value, level=$('#filtroNivel').value;
  const list=exercises.filter(e=>(region==='todos'||e.region===region)&&(level==='todos'||e.level===level));
  $('#exerciseGrid').innerHTML=list.map(e=>`<article class="exercise-card"><div class="exercise-cover">${e.icon}</div><div class="exercise-body"><div class="chips"><span class="chip">${e.region}</span><span class="chip">${e.level}</span></div><h3>${e.title}</h3><p>${e.desc}</p><div class="card-row"><small>⏱ ${e.minutes} min</small><button class="primary" data-exercise="${e.id}">Abrir</button></div></div></article>`).join('');
}

function openExercise(id){
  const e=exercises.find(x=>x.id===Number(id));
  if(!e)return;
  $('#exerciseDetail').innerHTML=`<div class="exercise-detail-layout"><div class="exercise-video">${e.icon}</div><div><span class="eyebrow">${e.region} · ${e.level}</span><h2>${e.title}</h2><p>${e.desc}</p><ol class="steps">${e.steps.map(s=>`<li>${s}</li>`).join('')}</ol><div class="alert">Conteúdo demonstrativo. Faça exercícios terapêuticos somente quando orientados para o seu caso.</div><div style="display:flex;gap:10px;margin-top:16px"><button class="primary" id="completeExercise">Marcar como concluído</button><button class="secondary" data-close>Fechar</button></div></div></div>`;
  openModal('#exerciseModal');
  $('#completeExercise').onclick=()=>{ addSession(e.title,e.minutes,3,'Ok'); closeModals(); toast('Sessão registrada no seu progresso.'); };
  $$('[data-close]',$('#exerciseModal')).forEach(b=>b.onclick=closeModals);
}

function defaultHistory(){ return [
  {exercise:'Mobilidade de ombro',minutes:8,pain:3,feeling:'Ok',date:'Hoje'},
  {exercise:'Alongamento lombar leve',minutes:7,pain:2,feeling:'Fácil',date:'Ontem'},
  {exercise:'Controle de tornozelo',minutes:10,pain:4,feeling:'Ok',date:'Há 2 dias'}
];}
function getHistory(){ try{return JSON.parse(localStorage.getItem('fisiolink_history'))||defaultHistory()}catch{return defaultHistory()} }
function saveHistory(h){ localStorage.setItem('fisiolink_history',JSON.stringify(h)); }
function addSession(exercise,minutes,pain,feeling){ const h=getHistory(); h.unshift({exercise,minutes:Number(minutes),pain:Number(pain),feeling,date:'Agora'}); saveHistory(h.slice(0,20)); renderProgress(); }

function renderProgress(){
  const h=getHistory();
  const total=h.length+5;
  const minutes=h.reduce((s,x)=>s+(Number(x.minutes)||0),0)+61;
  const pains=h.filter(x=>Number.isFinite(Number(x.pain))).map(x=>Number(x.pain));
  const avg=pains.length?(pains.reduce((a,b)=>a+b,0)/pains.length).toFixed(1).replace('.',','):'—';
  $('#totalSessions').textContent=total;
  $('#totalMinutes').textContent=minutes;
  $('#avgPain').textContent=`${avg}/10`;
  const weekly=Math.min(4,Math.max(1,h.filter(x=>['Hoje','Ontem','Agora','Há 2 dias'].includes(x.date)).length));
  $('#weekLabel').textContent=`${weekly}/4 sessões`;
  $('#weekBar').style.width=`${weekly/4*100}%`;
  const labels=['S','T','Q','Q','S','S','D'];
  $('#weekDays').innerHTML=labels.map((d,i)=>`<div class="day ${i<weekly?'done':''}"><i>${i<weekly?'✓':i+1}</i><span>${d}</span></div>`).join('');
  $('#historyList').innerHTML=h.length?h.slice(0,6).map(x=>`<div class="history-item"><div><b>${x.exercise}</b><small>${x.date} · ${x.minutes} min · dor ${x.pain}/10</small></div><span class="chip">${x.feeling}</span></div>`).join(''):'<p style="color:var(--muted)">Nenhuma sessão registrada ainda.</p>';
}

function renderProfessionals(list=professionals){
  $('#professionalGrid').innerHTML=list.map((p,i)=>`<article class="professional-card"><div class="professional-top"><div class="professional-avatar">${p.initials}</div><div><b>${p.name}</b><div class="verified">✓ Perfil demonstrativo verificado</div><small>${p.type}</small></div></div><p>${p.specialty}</p><div class="professional-meta"><span>⭐ ${p.rating}</span><span>📍 ${p.distance.toFixed(1).replace('.',',')} km</span><span>🏙 ${p.city}</span><span>💬 Responde rápido</span></div><button class="primary full" data-book="${i}">Solicitar atendimento</button></article>`).join('');
}

function handleLocation(){
  if(!navigator.geolocation){toast('Seu navegador não oferece geolocalização.');return;}
  toast('Solicitando sua localização…');
  navigator.geolocation.getCurrentPosition(()=>{
    const sorted=[...professionals].sort((a,b)=>a.distance-b.distance);
    renderProfessionals(sorted);
    toast('Profissionais ordenados por proximidade demonstrativa.');
  },()=>toast('Localização não autorizada. Você pode continuar usando a busca.'));
}

function initAuth(){
  $('#btnEntrar').onclick=()=>openModal('#authModal');
  $$('[data-open="cadastro"]').forEach(b=>b.onclick=()=>openModal('#cadastroModal'));
  $$('[data-profile]').forEach(b=>b.onclick=()=>{currentProfile=b.dataset.profile;$('#authChoice').classList.add('hidden');$('#loginForm').classList.remove('hidden');$('#loginTitle').textContent=currentProfile==='paciente'?'Entrar como paciente':'Entrar como profissional';});
  $('#backAuth').onclick=()=>{$('#loginForm').classList.add('hidden');$('#authChoice').classList.remove('hidden')};
  $('#loginForm').onsubmit=e=>{e.preventDefault(); localStorage.setItem('fisiolink_user',JSON.stringify({email:$('#loginEmail').value,profile:currentProfile})); closeModals(); $('#btnEntrar').textContent=currentProfile==='paciente'?'Minha conta':'Painel profissional'; toast('Login demonstrativo realizado.'); if(currentProfile==='paciente')showView('progresso'); else toast('Painel profissional demonstrativo ativado.');};
  $('#cadastroForm').onsubmit=e=>{e.preventDefault(); const u={name:$('#cadNome').value,email:$('#cadEmail').value,profile:$('#cadPerfil').value,city:$('#cadCidade').value}; localStorage.setItem('fisiolink_user',JSON.stringify(u)); closeModals(); $('#btnEntrar').textContent='Minha conta'; toast('Conta demonstrativa criada e salva neste navegador.');};
}

function init(){
  renderExercises(); renderProgress(); renderProfessionals(); initAuth();
  $$('.nav-btn,[data-view]').forEach(b=>b.addEventListener('click',()=>b.dataset.view&&showView(b.dataset.view)));
  $('#filtroRegiao').onchange=renderExercises; $('#filtroNivel').onchange=renderExercises;
  $('#exerciseGrid').onclick=e=>{const b=e.target.closest('[data-exercise]'); if(b)openExercise(b.dataset.exercise)};
  $('#btnNovaSessao').onclick=()=>openModal('#sessionModal');
  $('#sessionExercise').innerHTML=exercises.map(e=>`<option>${e.title}</option>`).join('');
  $('#sessionForm').onsubmit=e=>{e.preventDefault();addSession($('#sessionExercise').value,$('#sessionMinutes').value,$('#sessionPain').value,$('#sessionFeeling').value);closeModals();toast('Sessão salva com sucesso.');};
  $('#btnLimparHistorico').onclick=()=>{localStorage.removeItem('fisiolink_history');renderProgress();toast('Histórico demonstrativo restaurado.');};
  $('#professionalSearch').oninput=e=>{const q=e.target.value.toLowerCase();renderProfessionals(professionals.filter(p=>`${p.name} ${p.specialty} ${p.type}`.toLowerCase().includes(q)));};
  $('#btnLocalizacao').onclick=handleLocation;
  $('#professionalGrid').onclick=e=>{const b=e.target.closest('[data-book]'); if(!b)return; currentProfessional=professionals[Number(b.dataset.book)]||professionals[0]; $('#bookingTitle').textContent=`Atendimento com ${currentProfessional.name}`; const d=new Date();d.setDate(d.getDate()+1);$('#bookingDate').min=d.toISOString().split('T')[0];openModal('#bookingModal');};
  $('#bookingForm').onsubmit=e=>{e.preventDefault();const req={professional:currentProfessional?.name||'Profissional',name:$('#bookingName').value,phone:$('#bookingPhone').value,date:$('#bookingDate').value,mode:$('#bookingMode').value};localStorage.setItem('fisiolink_last_booking',JSON.stringify(req));closeModals();toast('Solicitação registrada no protótipo.');e.target.reset();};
  $$('[data-tip]').forEach(b=>b.onclick=()=>{const t=tips[b.dataset.tip];$('#tipContent').innerHTML=`<span class="eyebrow">Informação geral</span><h2>${t.title}</h2><p>${t.text}</p><div class="alert">Este conteúdo é educativo e não substitui avaliação individual.</div>`;openModal('#tipModal')});
  $$('[data-close]').forEach(b=>b.onclick=closeModals);
  $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
  $('#btnAcessibilidade').onclick=()=>{document.body.classList.toggle('large-text');toast(document.body.classList.contains('large-text')?'Texto ampliado.':'Tamanho de texto normal.');};
  const saved=localStorage.getItem('fisiolink_user'); if(saved) $('#btnEntrar').textContent='Minha conta';
}

document.addEventListener('DOMContentLoaded',init);
