import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, onSnapshot, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// TRASA Eventos V1.6 — inscripciones entre 1 y 4 participantes.
const root = document.querySelector('#root');
const badge = document.querySelector('#eventBadge');
const conn = document.querySelector('#connectionBadge');
const title = document.querySelector('#pageTitle');
const adminTabs = ['general','premios','equipos','revisiones','retos','historico'];
const teamKey = 'trasa_ojo_verde_equipo';
const DEFAULT_EVENT_NAME = 'Operación Ojo Verde';
const DEFAULT_EVENT_DESCRIPTION = 'Explora San Andreas, identifica residuos y lugares de recuperación y demuestra tu trabajo con fotografías. Cuantas más pruebas válidas, más puntos.';
const DEFAULT_PARTICIPATION = 'Participa individualmente o forma un equipo de hasta 4 personas. Registra los nombres y State IDs de los participantes y un teléfono de contacto RP. Guarda el enlace privado del equipo y, cuando comience el concurso, pega las URLs de las fotografías en sus pruebas correspondientes.';
const DEFAULT_DURATION_MINUTES = 120;
const OLD_DEFAULT_PARTICIPATION = 'Forma un equipo de 2 a 4 personas. Registra sus nombres, State IDs y un teléfono de contacto RP. Guarda el enlace privado del equipo y, cuando comience el concurso, pega las URLs de las fotografías en sus pruebas correspondientes.';
function participationInstructions(){const value=A.control?.participationInstructions;return !value || value===OLD_DEFAULT_PARTICIPATION ? DEFAULT_PARTICIPATION : value;}
function eventDuration(){const n=Number(A.control?.durationMinutes ?? DEFAULT_DURATION_MINUTES);return Number.isInteger(n)&&n>=5&&n<=480?n:DEFAULT_DURATION_MINUTES;}
function remainingMs(){const start=A.control?.startedAt?.toMillis?.();if(!start)return null;return Math.max(0, start+eventDuration()*60*1000-Date.now());}
function isAccepting(){return isLive() && (remainingMs() === null || remainingMs()>0);}
function countDownText(){const left=remainingMs();if(left===null)return 'Sin iniciar';if(left<=0)return 'TIEMPO AGOTADO';const sec=Math.ceil(left/1000),hours=Math.floor(sec/3600),minutes=Math.floor((sec%3600)/60),seconds=sec%60;return [hours,minutes,seconds].map(x=>String(x).padStart(2,'0')).join(':');}
function clockCard(){return isLive()?`<div class="countdown-card"><div><small>TIEMPO RESTANTE</small><strong data-countdown>${esc(countDownText())}</strong></div><p>Duración: ${eventDuration()} minutos · Las entregas se cierran al terminar la cuenta atrás.</p></div>`:'';}
let lastClockExpired=false;
function tickClock(){if(badge&&A.control)badge.textContent=stateTxt();if(isLive())document.querySelectorAll('[data-countdown]').forEach(el=>el.textContent=countDownText());const header=document.querySelector('#timeBadge');if(header){header.hidden=!isLive();if(isLive())header.textContent=countDownText();}if(isLive()&&remainingMs()===0&&!lastClockExpired){lastClockExpired=true;if(A.view==='tasks')refresh();}if(remainingMs()>0)lastClockExpired=false;}
setInterval(tickClock,1000);
function eventName(){ return A.control?.eventName || DEFAULT_EVENT_NAME; }
function eventDescription(){ return A.control?.eventDescription || DEFAULT_EVENT_DESCRIPTION; }
// Premios configurables. Compatibilidad: las ediciones V1.3 utilizaban «prizes» con 4 puestos fijos.
const LEGACY_PRIZE_KEYS = ['first','second','third','participation'];
const LEGACY_PRIZE_LABELS = {first:'🥇 Primer puesto',second:'🥈 Segundo puesto',third:'🥉 Tercer puesto',participation:'✅ Completar el evento'};
const LEGACY_DEFAULT_PRIZES = {
  first:{cash:800,materials:300,note:'Premio para el equipo ganador'},
  second:{cash:500,materials:200,note:'Segundo equipo clasificado'},
  third:{cash:300,materials:100,note:'Tercer equipo clasificado'},
  participation:{cash:600,materials:0,note:'Pago máximo por equipo que complete la misión, sujeto a penalizaciones por daños'}
};
const DEFAULT_AWARDS = LEGACY_PRIZE_KEYS.map(k=>({
  id:k,title:LEGACY_PRIZE_LABELS[k],...LEGACY_DEFAULT_PRIZES[k],extra:''
}));
function normalizeAward(item,index){
  return {
    id:String(item?.id||`premio_${index+1}`),
    title:String(item?.title||`Premio ${index+1}`),
    cash:Number(item?.cash||0),
    materials:Number(item?.materials||0),
    extra:String(item?.extra||''),
    note:String(item?.note||'')
  };
}
function prizeSettings(){
  // [] significa que la organización ha elegido no anunciar premios.
  if(Array.isArray(A.control?.awards))return A.control.awards.map(normalizeAward);
  if(A.control?.prizes && typeof A.control.prizes==='object') {
    return LEGACY_PRIZE_KEYS.map((k,i)=>normalizeAward({id:k,title:LEGACY_PRIZE_LABELS[k],...LEGACY_DEFAULT_PRIZES[k],...(A.control.prizes[k]||{})},i));
  }
  return DEFAULT_AWARDS.map((p,i)=>normalizeAward(p,i));
}
function prizeSummary(p){
  return [
    Number(p.cash)>0?`${Number(p.cash).toLocaleString('es-ES')} $`:null,
    Number(p.materials)>0?`${Number(p.materials).toLocaleString('es-ES')} materiales gratis`:null,
    String(p.extra||'').trim()||null
  ].filter(Boolean).join(' + ')||'Recompensa indicada en las condiciones';
}
function newPrizeId(){return 'premio_'+generateSecret().slice(0,20);}
const A = { app:null,auth:null,db:null,user:null,view:'home',adminTab:'general',adminMode:false,
  control:null,teamId:sessionTeamId(),team:null,submissions:[],challenges:[],scores:[],allTeams:[],adminSelected:'',allSubs:[],awardDraft:null,
  membersCount:1,subSelected:'',busy:false,unsubs:[],challengeEditor:null,archives:[] };

function esc(v='') { return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(t){ const x=t?.toDate?t.toDate():t instanceof Date?t:null;return x?x.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'; }
function unix(t){return t?.toMillis?t.toMillis():0;}
function generateSecret(){let x=new Uint8Array(24);crypto.getRandomValues(x);return [...x].map(v=>v.toString(16).padStart(2,'0')).join('');}
function urlForTeam(t){let url=new URL(location.href);url.hash='equipo='+encodeURIComponent(t);return url.href;}
function sessionTeamId(){const hash=location.hash.match(/(?:^#|&)equipo=([a-zA-Z0-9_-]{32,64})/);return hash?.[1]||localStorage.getItem(teamKey)||'';}
function slug(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);}
function cleanURL(value){try{let u=new URL(String(value).trim());if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.href.length>1000)throw Error('url');return u.href;}catch{throw Error('Introduce un enlace HTTPS válido de la foto.');}}
function notify(msg){const x=document.querySelector('#toast');x.textContent=msg;x.classList.add('show');clearTimeout(notify._t);notify._t=setTimeout(()=>x.classList.remove('show'),4900);}
function problem(e){const msg=String(e?.message||e||'Error desconocido');console.error('TRASA Firebase:',e);const denied=e?.code==='permission-denied'||msg.includes('permission-denied');notify(denied?(A.user&&!A.user.isAnonymous?'Firebase ha denegado el acceso de administrador. Comprueba el UID y el proyecto en Administración → Resumen.':'Firebase ha denegado la operación. Comprueba el estado del concurso y los permisos de la cuenta.'):msg);}
function loading(v){A.busy=v;document.querySelectorAll('[data-busy]').forEach(x=>x.disabled=v);}
function canUse(){return !!A.db && !!A.user;}
function stateTxt(){let s=A.control?.status;return s==='live'?(remainingMs()===0?'TIEMPO AGOTADO':'EVENTO EN CURSO'):s==='finished'?'EVENTO CERRADO':s==='registration'?'INSCRIPCIONES':s==='resetting'?'PREPARANDO EDICIÓN':'SIN PREPARAR';}
function isLive(){return A.control?.status==='live';}
function visibleChallenges(){return isLive()||A.control?.status==='finished'||A.adminMode;}
function getTeamId(){return A.teamId&&/^[A-Za-z0-9_-]{32,64}$/.test(A.teamId)?A.teamId:'';}
function statusBadge(st){return `<span class="chip ${esc(st)}">${{pending:'Pendiente',approved:'Aprobada',rejected:'Rechazada'}[st]||esc(st||'Sin entregar')}</span>`;}
function blank(msg){return `<div class="empty">${esc(msg)}</div>`;}

async function start(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();navigate(b.dataset.nav);}));
  if(Object.values(firebaseConfig).some(x=>String(x).startsWith('REEMPLAZAR_'))){
    conn.textContent='Pendiente de Firebase';root.innerHTML=`<div class="notice warn"><strong>Configuración inicial pendiente</strong>Rellena <code>config.js</code> con los datos de tu nueva aplicación Firebase, publica las reglas y vuelve a abrir la web. Consulta la guía incluida en el ZIP.</div>`;return;
  }
  try{
    A.app=initializeApp(firebaseConfig);A.auth=getAuth(A.app);A.db=getFirestore(A.app);
    onAuthStateChanged(A.auth,async user=>{
      A.user=user;A.adminMode=!!user&&!user.isAnonymous; // Solo interfaz; Firestore comprueba UID administrador en el servidor.
      conn.textContent=user?(user.isAnonymous?'Conectado':'Sesión administrador'):'Conectando…';
      conn.className='pill '+(user?'ok':'');
      if(!user){try{await signInAnonymously(A.auth);}catch(e){problem(e)}return;}
      subscribeControl();
      if(A.teamId)await openTeam(A.teamId,true);
      if(A.view==='admin'&&A.adminMode)await loadAdmin();
      refresh();
    });
  }catch(e){problem(e);root.innerHTML='<div class="notice bad">Error inicializando Firebase. Comprueba el archivo config.js.</div>';}
}
let unsubscribeControl=()=>{}, unsubscribeTeam=()=>{}, unsubscribeSubmissions=()=>{}, unsubscribeScores=()=>{};
function subscribeControl(){unsubscribeControl();unsubscribeScores();
  unsubscribeControl=onSnapshot(doc(A.db,'control','main'),s=>{A.control=s.exists()?s.data():null;refresh();tickClock();if(visibleChallenges()&&A.view==='tasks')loadChallenges();},problem);
  // El ranking público no contiene IDs privados de equipo ni datos personales.
  unsubscribeScores=onSnapshot(doc(A.db,'leaderboard','current'),s=>{
    A.scores=s.exists()&&Array.isArray(s.data().results)?s.data().results:[];
    if(A.view==='ranking'||A.view==='home')refresh();
  },problem);
}
async function openTeam(id,quiet=false){
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(id))throw Error('Código de equipo inválido.');
  try{
    const snapshot=await getDoc(doc(A.db,'teams',id));if(!snapshot.exists()){if(quiet){A.teamId='';A.team=null;A.submissions=[];localStorage.removeItem(teamKey);history.replaceState(null,'',location.pathname+location.search);}throw Error('No se encuentra el equipo. Comprueba el enlace.');}
    A.teamId=id;A.team={id,...snapshot.data()};localStorage.setItem(teamKey,id);
    history.replaceState(null,'',urlForTeam(id));
    unsubscribeTeam();unsubscribeSubmissions();
    unsubscribeTeam=onSnapshot(doc(A.db,'teams',id),s=>{
      if(!s.exists()){
        A.team=null;A.teamId='';A.submissions=[];A.subSelected='';
        localStorage.removeItem(teamKey);history.replaceState(null,'',location.pathname+location.search);
        unsubscribeSubmissions();unsubscribeTeam();notify('El equipo ha sido eliminado por la organización.');
        refresh();return;
      }
      A.team={id,...s.data()};if(A.view==='team')refresh();
    },problem);
    unsubscribeSubmissions=onSnapshot(collection(A.db,'teams',id,'submissions'),s=>{A.submissions=s.docs.map(d=>({id:d.id,...d.data()}));if(A.view==='tasks'||A.view==='team')refresh();},problem);
    if(!quiet)notify('Equipo cargado correctamente.');
    return true;
  }catch(e){if(!quiet)problem(e);return false;}
}
function navigate(view){A.view=view;if(view==='tasks'&&visibleChallenges())loadChallenges();if(view==='admin'&&A.adminMode)loadAdmin();refresh();}
function refresh(){if(!A.db)return;
  badge.textContent=stateTxt();badge.className='pill '+(isLive()?'ok':A.control?.status==='registration'?'warn':'');
  const pages={home:'Resumen del evento',team:'Mi equipo',tasks:'Pruebas fotográficas',ranking:'Clasificación',admin:'Administración'};
  title.textContent=A.view==='home'?eventName():pages[A.view];document.title=`TRASA · ${eventName()}`;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav===A.view));
  root.innerHTML=({home,team,tasks,ranking,admin}[A.view]||home)();bindForms();tickClock();
}
function home(){return `<section class="hero"><div><div class="eyebrow">TRASA PRESENTA</div><h2>${esc(eventName())}</h2><p class="event-description">${esc(eventDescription())}</p><div class="actions"><button class="button white" data-action="team">Acceder a mi equipo →</button><button class="button white" data-action="tasks">Consultar pruebas ↗</button></div></div><img class="hero-logo" src="assets/logotipo.webp" alt="TRASA · Tratamiento de Residuos Antón"></section>
  <div class="sectionhead"><h2>Estado de la jornada</h2></div><div class="grid"><div class="stat"><small>EVENTO</small><strong>${esc(stateTxt())}</strong></div><div class="stat"><small>PRUEBAS</small><strong>${visibleChallenges()?A.challenges.length:'Ocultas'}</strong></div><div class="stat"><small>INSCRIPCIONES</small><strong>${A.control?.registrationOpen?'Abiertas':'Cerradas'}</strong></div><div class="stat clock-stat"><small>TIEMPO RESTANTE</small><strong data-countdown>${isLive()?esc(countDownText()):A.control?.status==='finished'?'Finalizado':'Sin iniciar'}</strong></div></div>
  <div class="panel"><h3>¿Cómo participar?</h3><p class="participation-text">${esc(participationInstructions())}</p>${!isLive()&&A.control?.status!=='finished'?'<div class="notice warn"><strong>Pruebas ocultas</strong>Los objetivos no se mostrarán hasta que la organización inicie el evento.</div>':''}</div>
  ${A.control?`<div class="panel"><h3>Premios de esta edición</h3>${prizeSettings().length?`<div class="reward-grid">${prizeSettings().map(p=>`<div class="reward-item"><strong>${esc(p.title)}</strong><span>${esc(prizeSummary(p))}</span>${p.note?`<small>${esc(p.note)}</small>`:''}</div>`).join('')}</div><p class="hint">Las recompensas y sus condiciones se aplican según lo publicado por la organización.</p>`:'<p class="hint">Todavía no se han anunciado premios para esta edición.</p>'}</div>`:''}`;}
function team(){if(!A.team){return `<div class="panel"><h2>Crear equipo</h2><p>Solo necesitas el nombre y State ID de entre 1 y 4 jugadores, más un teléfono dentro del juego.</p>${A.control?.registrationOpen&&A.control?.status==='registration'?registerForm():'<div class="notice warn">Las inscripciones están cerradas. Espera a que la organización las abra.</div>'}</div><div class="panel"><h3>Ya tengo un enlace privado</h3><form id="accessTeam"><label>Código privado del equipo</label><div class="fields2"><input name="code" maxlength="64" placeholder="Código de 48 caracteres" required><button class="primary" type="submit">Entrar</button></div></form><p class="hint">También puedes abrir el enlace que te envió el capitán.</p></div>`;}
  return `<div class="panel"><div class="row"><div><div class="eyebrow">TU EXPEDIENTE</div><h2>${esc(A.team.name)}</h2></div><span class="chip approved">${A.team.members.length} participante${A.team.members.length===1?'':'s'}</span></div><p>Teléfono de contacto: <b>${esc(A.team.phone)}</b></p><div class="hr"></div><h3>Participantes inscritos</h3>${A.team.members.map((m,i)=>`<div class="teamitem"><span>${i+1}. <strong>${esc(m.name)}</strong></span><span class="muted">State ID: ${esc(m.stateId)}</span></div>`).join('')}<div class="hr"></div><h3>Enlace privado</h3><div class="code">${esc(urlForTeam(A.teamId))}</div><div class="actions"><button class="secondary" data-action="copyTeam">Copiar enlace</button><button class="plain" data-action="forgetTeam">Salir de este equipo en este navegador</button></div><p class="secret-note">Cualquiera con el enlace podrá consultar y presentar pruebas para el equipo. No lo publiques en canales abiertos.</p></div>`;}
function memberFields(n,p={}){return `<div class="person"><strong>Participante ${n} ${n===1?'· Capitán':''}</strong><div class="fields2"><div><label>Nombre del personaje</label><input required name="player${n}" maxlength="70" value="${esc(p.name||'')}" placeholder="Nombre y apellido"></div><div><label>State ID</label><input required name="id${n}" maxlength="12" pattern="[0-9]{1,12}" inputmode="numeric" value="${esc(p.stateId||'')}" placeholder="Ej. 1842"></div></div></div>`;}
function registerForm(){return `<form id="registerTeam"><div class="fields2"><div class="field"><label>Nombre del equipo</label><input name="teamName" maxlength="60" minlength="3" required placeholder="Los Chatarreros"></div><div class="field"><label>Teléfono RP de contacto</label><input name="phone" minlength="4" maxlength="35" required placeholder="Ej. 555-0194"></div></div><div class="sectionhead"><h3>Participantes (1–4)</h3><span class="chip">${A.membersCount} / 4</span></div><div id="memberFields">${Array.from({length:A.membersCount},(_,i)=>memberFields(i+1)).join('')}</div><div class="form-actions"><button type="button" class="secondary" data-action="minusMember" ${A.membersCount===1?'disabled':''}>− Quitar</button><button type="button" class="secondary" data-action="plusMember" ${A.membersCount===4?'disabled':''}>+ Añadir</button><button type="submit" class="primary" data-busy>Registrar equipo</button></div></form>`;}
function tasks(){if(!A.team)return `<div class="notice warn"><strong>Primero accede a un equipo</strong>Necesitas el código privado para presentar fotografías. <button class="plain" data-action="team">Ir a Mi equipo</button></div>`;
  if(!visibleChallenges())return `<div class="locked"><span class="symbol">🔒</span><h2>Las pruebas permanecen ocultas</h2><p>Los objetivos, descripciones y puntos se mostrarán cuando TRASA inicie oficialmente el concurso.</p><span class="chip pending">${esc(stateTxt())}</span></div>`;
  if(!A.challenges.length)return `<div class="panel">${blank('Cargando las pruebas… Si no aparecen, la organización todavía no las ha preparado.')}</div>`;
  const total=A.challenges.length,approved=A.submissions.filter(s=>s.status==='approved').length;
  return `${clockCard()}<div class="grid"><div class="stat"><small>PRUEBAS APROBADAS</small><strong>${approved}/${total}</strong></div><div class="stat"><small>ENTREGAS REGISTRADAS</small><strong>${A.submissions.length}</strong></div><div class="stat"><small>ESTADO</small><strong>${isLive()?'En curso':'Cerrado'}</strong></div></div>
    <div class="sectionhead"><h2>Objetivos de inspección</h2><span class="muted">Una URL por objetivo · Máximo 3 intentos</span></div><div class="taskgrid">${A.challenges.map(t=>taskCard(t)).join('')}</div>`;}
function taskCard(t){let s=A.submissions.find(x=>x.id===t.id), canSubmit=isAccepting()&&(!s||s.status==='rejected'&&s.attempt<3);
  return `<article class="task"><div class="row"><span class="mark">${esc(t.category||'Inspección')}</span><span class="chip">${Number(t.points||0)} puntos</span></div><h3>${esc(t.title)}</h3><p>${esc(t.description||'')}</p><div class="row">${s?statusBadge(s.status):'<span class="chip">Sin entregar</span>'}<span class="muted">${s?`Intento ${s.attempt}/3`:''}</span></div>${s?.url?`<a class="button secondary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Abrir fotografía ↗</a>`:''}${s?.status==='rejected'&&s?.reason?`<small class="dangerText">Motivo: ${esc(s.reason)}</small>`:''}${canSubmit?(A.subSelected===t.id?`<form id="photoForm" data-id="${esc(t.id)}"><label>URL HTTPS de la fotografía</label><input name="url" type="url" placeholder="https://..." required autocomplete="off"><div class="actions"><button class="primary" type="submit">Confirmar entrega</button><button class="secondary" type="button" data-action="cancelPhoto">Cancelar</button></div></form>`:`<button class="primary" data-action="submitPhoto" data-id="${esc(t.id)}">${s?'Corregir fotografía':'Pegar URL de fotografía'}</button>`):''}</article>`;}
function ranking(){if(!A.scores.length)return `<div class="panel"><h2>Clasificación</h2><p>El ranking se construye con fotografías aprobadas desde Administración.</p>${blank('Todavía no hay resultados registrados.')}</div>`;
 let arr=[...A.scores].sort((a,b)=>(b.points||0)-(a.points||0)||(b.approvedCount||0)-(a.approvedCount||0)||((a.completedAt?unix(a.completedAt):Infinity)-(b.completedAt?unix(b.completedAt):Infinity))||a.teamName.localeCompare(b.teamName));
 return `<div class="panel"><h2>Clasificación oficial</h2><p>Primero la puntuación; en empate con cartón completo, termina antes quien entregó antes su última fotografía válida. Las entregas pendientes no puntúan.</p><div class="table-wrap"><table><thead><tr><th>Posición</th><th>Equipo</th><th>Puntos</th><th>Validadas</th><th>Finalización</th></tr></thead><tbody>${arr.map((x,i)=>`<tr><td><b>${i+1}º</b></td><td class="name">${esc(x.teamName)}</td><td>${Number(x.points||0)}</td><td>${Number(x.approvedCount||0)}</td><td>${x.completedAt?fmt(x.completedAt):'—'}</td></tr>`).join('')}</tbody></table></div></div>`;}
function admin(){if(!A.adminMode)return `<div class="panel" style="max-width:520px;margin:10px auto"><img src="assets/emblema.webp" alt="TRASA" style="display:block;width:70px;margin:0 auto 20px"><h2>Acceso a Administración</h2><p>Solo la organización puede modificar equipos, aprobar fotos e iniciar el evento. Este acceso se verifica en Firebase Authentication.</p><form id="adminLogin"><div class="field"><label>Correo de administrador</label><input name="email" type="email" autocomplete="username" required placeholder="correo@ejemplo.com"></div><div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div><button class="primary" type="submit" data-busy>Entrar</button></form><p class="hint">Los participantes no necesitan correo, contraseñas ni cuentas vinculadas.</p></div>`;
 return `<div class="row" style="margin:0 0 16px"><span class="chip approved">Sesión con correo iniciada · permisos pendientes de verificar</span><button class="plain" data-action="adminLogout">Cerrar sesión</button></div><div class="admin-tabs">${adminTabs.map((v,i)=>`<button class="${A.adminTab===v?'primary':'secondary'}" data-action="adminTab" data-tab="${v}">${['Resumen','Premios','Equipos','Revisar fotos','Pruebas','Historial'][i]}</button>`).join('')}</div>${A.adminTab==='general'?adminDiagnostic():''}${({general:adminGeneral,premios:adminPrizes,equipos:adminTeams,revisiones:adminReviews,retos:adminChallenges,historico:adminHistory}[A.adminTab]||adminGeneral)()}`;}
function adminDiagnostic(){
 const uid=A.user?.uid||'Sin sesión';
 const project=String(firebaseConfig.projectId||'Sin projectId');
 return `<div class="panel"><h2>Diagnóstico de permisos Firebase</h2><p>Iniciar sesión con correo no garantiza permisos de administrador. Firebase solo permitirá las modificaciones si tu UID coincide con la función <code>isAdmin()</code> de las reglas publicadas.</p><div class="fields2"><div class="field"><label>UID de la sesión actual</label><input readonly value="${esc(uid)}" style="font-family:monospace"/></div><div class="field"><label>Proyecto Firebase utilizado por la web</label><input readonly value="${esc(project)}" style="font-family:monospace"/></div></div><div class="actions"><button class="secondary" data-action="testAdminAccess">Comprobar mis permisos</button><button class="plain" data-action="copyAdminUID">Copiar mi UID</button></div><p class="hint">Si la comprobación falla, revisa que el UID de arriba sea idéntico al de <code>request.auth.uid == '...'</code> en Firestore → Reglas y pulsa Publicar. No cambies las reglas a acceso público.</p></div>`;
}
function adminGeneral(){
 const status=A.control?.status;
 return `<div class="grid"><div class="stat"><small>EQUIPOS REGISTRADOS</small><strong>${A.allTeams.length}</strong></div><div class="stat"><small>PRUEBAS PREPARADAS</small><strong>${A.challenges.length}</strong></div><div class="stat"><small>EDICIÓN</small><strong>${Number(A.control?.editionNumber||1)}</strong></div><div class="stat clock-stat"><small>TIEMPO RESTANTE</small><strong data-countdown>${isLive()?esc(countDownText()):A.control?.status==='finished'?'Finalizado':'Sin iniciar'}</strong></div></div>
 <div class="panel"><h2>Control de la jornada</h2><p>Las pruebas están ocultas antes del inicio. Puedes reutilizar o editar las pruebas para la siguiente edición.</p>
 ${!A.control?`<button class="primary" data-action="setupEvent">Crear jornada inicial</button>`:
 `<div class="actions">
 <button class="${A.control.registrationOpen?'danger':'secondary'}" data-action="toggleRegistrations" ${status!=='registration'?'disabled':''}>${A.control.registrationOpen?'Cerrar inscripciones':'Abrir inscripciones'}</button>
 <button class="primary" data-action="startEvent" ${status!=='registration'||!A.challenges.length?'disabled':''}>Iniciar concurso</button>
 <button class="danger" data-action="finishEvent" ${status!=='live'?'disabled':''}>Finalizar concurso</button>
 ${status==='finished'?'<button class="primary" data-action="newEdition">Preparar nueva edición ↻</button>':''}
 ${status==='resetting'?'<button class="primary" data-action="resumeEdition">Reanudar preparación ↻</button>':''}
 </div>`}
 ${status==='finished'?'<div class="notice warn"><strong>Antes de crear otra edición</strong>Termina de revisar las fotografías. Se archivará la clasificación; después se eliminarán los equipos, sus URLs y sus inscripciones actuales. Se liberarán los State IDs. Las pruebas y los premios configurados se conservarán. Si quieres conservar los enlaces de las fotos, expórtalos primero.</div><button class="secondary" data-action="exportDeliveries">Exportar entregas y enlaces CSV</button>':''}
 ${status==='resetting'?'<div class="notice warn"><strong>Preparación interrumpida o en curso</strong>Las inscripciones siguen bloqueadas. Usa «Reanudar preparación» para completar la limpieza sin perder el archivo de resultados.</div>':''}
 <div class="actions"><button class="secondary" data-action="publishLeaderboard" ${!A.control?'disabled':''}>Actualizar clasificación pública</button><a class="button secondary" href="demo.html" target="_blank" rel="noopener noreferrer">Abrir demostración sin tocar el evento ↗</a><button class="danger" data-action="resetEditionNumber" ${status!=='registration'||A.allTeams.length?'disabled':''}>Reiniciar numeración de ediciones</button></div><p class="hint">Reiniciar numeración establece la edición actual en 1, sin borrar el historial. Solo se permite durante inscripciones y sin equipos. Para eliminar clasificaciones archivadas utiliza la pestaña Historial.</p>
 </div>
 <div class="panel"><h2>Configuración del evento</h2><p>Modifica la portada, el texto de participación y la duración de cada nueva jornada.</p><form id="eventDetails"><div class="field"><label>Nombre del evento</label><input name="eventName" minlength="3" maxlength="75" required value="${esc(eventName())}"></div><div class="field"><label>Descripción de la portada</label><textarea name="eventDescription" minlength="10" maxlength="600" required>${esc(eventDescription())}</textarea></div><div class="field"><label>¿Cómo participar?</label><textarea name="participationInstructions" minlength="10" maxlength="1600" required class="participation-editor">${esc(participationInstructions())}</textarea></div><div class="field"><label>Duración del evento (minutos)</label><input name="durationMinutes" type="number" min="5" max="480" step="1" required value="${eventDuration()}" ${status==='live'?'readonly':''}><p class="hint">Entre 5 y 480 minutos. No se puede modificar una vez iniciado el evento.</p></div><button type="submit" class="primary" data-busy ${!A.control||status==='resetting'?'disabled':''}>Guardar configuración</button></form></div>`;
}
// Lee el editor visible para conservar los cambios aún no guardados al añadir, eliminar o mover una tarjeta.
function prizeDraftFromForm(){
  const form=root.querySelector('#prizesForm');
  if(!form)return (A.awardDraft||prizeSettings()).map(x=>({...x}));
  return [...form.querySelectorAll('[data-award-id]')].map((card,i)=>{
    const field=name=>card.querySelector(`[data-award-field="${name}"]`)?.value??'';
    return {id:card.dataset.awardId,title:field('title'),cash:field('cash'),materials:field('materials'),extra:field('extra'),note:field('note')};
  });
}
function adminPrizes(){
 const prizes=A.awardDraft===null?prizeSettings():A.awardDraft;
 const locked=!A.control||A.control?.status==='resetting';
 return `<div class="panel"><div class="row prize-heading"><div><h2>Premios del concurso</h2><p>Añade, elimina, renombra o reordena premios libremente. Puedes ofrecer un solo premio, dos, varios o ninguno.</p></div><span class="chip">${prizes.length} configurados</span></div>
 <form id="prizesForm">
 ${prizes.map((p,i)=>`<section class="prize-edit" data-award-id="${esc(p.id)}"><div class="row prize-edit-header"><h3>Premio ${i+1}</h3><div class="prize-controls"><button type="button" class="secondary" data-action="moveAwardUp" data-index="${i}" aria-label="Subir premio ${i+1}" title="Subir premio" ${i===0?'disabled':''}>↑</button><button type="button" class="secondary" data-action="moveAwardDown" data-index="${i}" aria-label="Bajar premio ${i+1}" title="Bajar premio" ${i===prizes.length-1?'disabled':''}>↓</button><button type="button" class="danger" data-action="removeAward" data-index="${i}" ${locked?'disabled':''}>Eliminar</button></div></div>
 <div class="field"><label>Nombre del premio o categoría</label><input data-award-field="title" maxlength="90" minlength="2" required value="${esc(p.title)}" placeholder="Ej. 🥇 Primer puesto / Premio especial"></div>
 <div class="fields2"><div class="field"><label>Dinero ($)</label><input data-award-field="cash" type="number" min="0" max="1000000" step="1" required value="${esc(p.cash)}"></div><div class="field"><label>Materiales con reciclaje gratis</label><input data-award-field="materials" type="number" min="0" max="100000" step="1" required value="${esc(p.materials)}"></div></div>
 <div class="field"><label>Otro premio o beneficio (texto libre)</label><input data-award-field="extra" maxlength="180" value="${esc(p.extra||'')}" placeholder="Ej. 30 % de descuento, una caja sorpresa, un vehículo..."></div>
 <div class="field"><label>Condiciones y descripción</label><textarea data-award-field="note" maxlength="400" placeholder="Ej. Vale por equipo, válido durante 30 días">${esc(p.note||'')}</textarea></div>
 </section>`).join('')}
 ${prizes.length?'':'<div class="empty">No hay premios configurados. Puedes añadir uno cuando quieras.</div>'}
 <div class="prize-editor-footer"><button type="button" class="secondary" data-action="addAward" ${prizes.length>=20||locked?'disabled':''}>+ Añadir premio</button><button type="submit" class="primary" data-busy ${locked?'disabled':''}>Guardar premios (${prizes.length})</button></div></form>
 <p class="hint">Los cambios, altas, bajas y el orden no se publican hasta pulsar «Guardar premios». Los títulos y beneficios se muestran exactamente como los configures. Los premios publicados se conservan al preparar otra edición.</p></div>`;
}
function adminHistory(){return `<div class="panel"><div class="row"><div><h2>Historial de ediciones</h2><p>Clasificaciones archivadas. El historial no incluye enlaces de fotografías.</p></div>${A.archives.length?'<button class="danger" data-action="deleteAllArchives">Borrar todo el historial</button>':''}</div><div class="notice warn"><strong>Atención</strong>El borrado de un evento archivado es definitivo. No altera la edición en curso ni libera los State IDs de la edición actual.</div>${A.archives.length?A.archives.map(a=>`<div class="archive-item"><div class="row"><strong>${esc(a.eventName||'Evento TRASA')} · Edición ${Number(a.editionNumber||1)}</strong><span class="muted">${fmt(a.finishedAt)}</span></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Equipo</th><th>Puntos</th><th>Fotos</th><th>Hora de finalización</th></tr></thead><tbody>${(a.results||[]).map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.teamName)}</td><td>${Number(r.points||0)}</td><td>${Number(r.approvedCount||0)}</td><td>${fmt(r.completedAt)}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="secondary" data-action="exportArchive" data-id="${esc(a.id)}">Exportar clasificación CSV</button><button class="danger" data-action="deleteArchive" data-id="${esc(a.id)}">Eliminar del historial</button></div></div>`).join(''):blank('Aún no hay ediciones archivadas.')}</div>`;}
function adminTeams(){if(!A.allTeams.length)return `<div class="panel">${blank('No hay equipos inscritos.')}</div>`;
return `<div class="panel"><h2>Equipos y participantes</h2>${A.allTeams.map(t=>`<div class="teamitem"><div><strong>${esc(t.name)}</strong><div class="muted">${t.members.length} jugadores · ${esc(t.phone)}</div></div><div class="actions"><button class="secondary" data-action="adminTeam" data-id="${esc(t.id)}">Ver / editar</button><button class="plain" data-action="adminOpenReviews" data-id="${esc(t.id)}">Fotografías</button><button class="danger" data-action="deleteTeam" data-id="${esc(t.id)}" title="Borrar equipo e inscripciones">Eliminar equipo</button></div></div>`).join('')}</div>${A.adminSelected?adminTeamEditor():''}`;}
function adminTeamEditor(){let t=A.allTeams.find(t=>t.id===A.adminSelected);if(!t)return '';
return `<div class="panel"><div class="row"><h2>Editar: ${esc(t.name)}</h2><button class="plain" data-action="closeTeamEditor">Cerrar</button></div><form id="editTeam"><div class="fields2"><div class="field"><label>Nombre del equipo</label><input name="teamName" value="${esc(t.name)}" required></div><div class="field"><label>Teléfono</label><input name="phone" value="${esc(t.phone)}" required></div></div>${Array.from({length:4},(_,i)=>`<div class="person"><strong>Participante ${i+1} ${i>=1?'(opcional)':''}</strong><div class="fields2"><input name="player${i+1}" value="${esc(t.members[i]?.name||'')}" placeholder="Nombre"><input name="id${i+1}" value="${esc(t.members[i]?.stateId||'')}" placeholder="State ID"></div></div>`).join('')}<button class="primary" type="submit" data-busy>Guardar cambios</button></form><div class="hr"></div><div class="actions"><button class="secondary" data-action="copySpecific" data-id="${esc(t.id)}">Copiar enlace privado</button><button class="danger" data-action="deleteTeam" data-id="${esc(t.id)}">Eliminar equipo definitivamente</button></div><p class="hint">La modificación actualiza las reservas de State IDs y nombres de equipo en una transacción. La eliminación borra también las entregas y libera los State IDs; no puede deshacerse.</p></div>`;}
function adminReviews(){let t=A.allTeams.find(t=>t.id===A.adminSelected);
 return `<div class="panel"><h2>Revisión de fotografías</h2><div class="field"><label>Filtrar por equipo</label><select id="reviewTeam"><option value="">Todos los equipos</option>${A.allTeams.map(t=>`<option value="${esc(t.id)}" ${t.id===A.adminSelected?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div><p>Abre cada URL en otra pestaña. Firebase registra la hora original de recepción, independientemente de cuándo apruebes la fotografía.</p><div class="table-wrap"><table><thead><tr><th>Equipo</th><th>Prueba</th><th>Enviada</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${A.allSubs.filter(s=>!A.adminSelected||s.teamId===A.adminSelected).sort((a,b)=>unix(b.submittedAt)-unix(a.submittedAt)).map(s=>`<tr><td>${esc(A.allTeams.find(t=>t.id===s.teamId)?.name||'—')}</td><td>${esc(A.challenges.find(t=>t.id===s.id)?.title||s.id)}</td><td>${fmt(s.submittedAt)}</td><td>${statusBadge(s.status)}</td><td><div class="actions"><a class="button secondary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>${s.status!=='approved'?`<button class="primary" data-action="reviewApprove" data-team="${esc(s.teamId)}" data-id="${esc(s.id)}">Aprobar</button>`:''}${s.status!=='rejected'?`<button class="danger" data-action="reviewReject" data-team="${esc(s.teamId)}" data-id="${esc(s.id)}">Rechazar</button>`:''}</div></td></tr>`).join('')}</tbody></table>${!A.allSubs.length?blank('Todavía no hay entregas.'):''}</div></div>`;}
function adminChallenges(){return `<div class="panel"><h2>Pruebas privadas</h2><div class="notice warn"><strong>Importante</strong>Las pruebas se guardan en Firestore. No subas el archivo JSON privado a GitHub: los jugadores podrían leerlo antes del evento.</div><div class="actions"><label class="button secondary" style="display:inline-flex;cursor:pointer">Importar JSON privado <input id="importChallenges" type="file" accept=".json,application/json" style="display:none"></label><button class="primary" data-action="createChallenge">Añadir una prueba</button></div><p class="hint">Puedes importarlas o editarlas mientras preparas el evento. Se recomienda no cambiar las pruebas una vez iniciada la competición.</p><div class="hr"></div>${A.challenges.map(t=>`<div class="teamitem"><div><strong>${esc(t.id)} · ${esc(t.title)}</strong><div class="muted">${Number(t.points)} pts · ${esc(t.category||'')}</div></div><button class="secondary" data-action="editChallenge" data-id="${esc(t.id)}">Editar</button></div>`).join('')||blank('No hay pruebas; importa el JSON privado de ejemplo.')}</div>${A.challengeEditor!==null?challengeForm():''}`;}
function challengeForm(){let t=A.challenges.find(x=>x.id===A.challengeEditor)||{id:'',title:'',description:'',category:'',points:10};return `<div class="panel"><h2>${t.id?'Editar prueba':'Nueva prueba'}</h2><form id="challengeForm"><div class="fields2"><div class="field"><label>ID corto (ej. p01)</label><input name="id" required maxlength="40" pattern="[A-Za-z0-9_-]{1,40}" ${t.id?'readonly':''} value="${esc(t.id)}"></div><div class="field"><label>Puntos</label><input name="points" required type="number" min="1" max="100" value="${Number(t.points)}"></div></div><div class="field"><label>Nombre de la prueba</label><input name="title" required maxlength="110" value="${esc(t.title)}"></div><div class="field"><label>Categoría</label><input name="category" maxlength="55" value="${esc(t.category)}"></div><div class="field"><label>Descripción para el jugador</label><textarea name="description" maxlength="650">${esc(t.description)}</textarea></div><div class="actions"><button type="submit" class="primary">Guardar prueba</button><button type="button" class="secondary" data-action="cancelChallenge">Cancelar</button></div></form></div>`;}

async function loadChallenges(){if(!visibleChallenges()||!A.db)return;try{
 const s=await getDocs(collection(A.db,'challenges'));A.challenges=s.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.id.localeCompare(b.id));
 if(A.view==='tasks'||A.view==='admin'||A.view==='home')refresh();
 }catch(e){problem(e)} }
async function loadAdmin(){if(!A.adminMode||!A.db)return;
 try{
   const [teams,challenge]=await Promise.all([getDocs(collection(A.db,'teams')),getDocs(collection(A.db,'challenges'))]);
   A.allTeams=teams.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
   A.challenges=challenge.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
   const lists=await Promise.all(A.allTeams.map(async t=>{
     const s=await getDocs(collection(A.db,'teams',t.id,'submissions'));
     return s.docs.map(d=>({id:d.id,teamId:t.id,...d.data()}));
   }));
   A.allSubs=lists.flat();if(A.adminTab==='historico')await loadArchives();else refresh();
 }catch(e){problem(e)} }

function readMembers(form,n){return Array.from({length:n},(_,i)=>{
  const name=form.elements[`player${i+1}`]?.value.trim()||'';
  const stateId=form.elements[`id${i+1}`]?.value.trim()||'';
  return {name,stateId};
});}
function verifyMembers(members){if(members.length<1||members.length>4)throw Error('El equipo debe tener entre 1 y 4 participantes.');
  if(members.some(x=>x.name.length<2||x.name.length>70||!/^[0-9]{1,12}$/.test(x.stateId)))throw Error('Comprueba nombres y State IDs numéricos.');
  if(new Set(members.map(x=>x.stateId)).size!==members.length)throw Error('Hay State IDs repetidos dentro del equipo.');
}
async function registerTeam(form){const name=form.elements.teamName.value.trim(),phone=form.elements.phone.value.trim();
 const members=readMembers(form,A.membersCount);verifyMembers(members);
 const nameKey=slug(name);if(name.length<3||name.length>60||nameKey.length<3)throw Error('Nombre del equipo inválido.');
 if(phone.length<4||phone.length>35)throw Error('Indica un teléfono RP válido.');
 if(!A.control?.registrationOpen||A.control.status!=='registration')throw Error('Inscripciones cerradas.');
 if(!A.user?.isAnonymous)throw Error('Sal de Administración antes de registrar un equipo.');
 const teamId=generateSecret(), ownerUid=A.user.uid, ids=members.map(m=>m.stateId);
 const batch=writeBatch(A.db);const teamRef=doc(A.db,'teams',teamId);
 batch.set(teamRef,{name,nameKey,phone,members,memberIds:ids,ownerUid,createdAt:serverTimestamp()});
 for(const stateId of ids)batch.set(doc(A.db,'stateClaims',stateId),{teamId,ownerUid,createdAt:serverTimestamp()});
 batch.set(doc(A.db,'captains',ownerUid),{teamId,createdAt:serverTimestamp()});
 batch.set(doc(A.db,'teamNames',nameKey),{teamId,createdAt:serverTimestamp()});
 await batch.commit();A.membersCount=1;await openTeam(teamId,true);notify('Equipo inscrito. Guarda el enlace privado.');navigate('team');}
async function savePhoto(id,link){if(!A.team||!isAccepting())throw Error('El plazo ha terminado o no has seleccionado un equipo.');
 const url=cleanURL(link);const s=A.submissions.find(s=>s.id===id);const ref=doc(A.db,'teams',A.teamId,'submissions',id);
 if(!s){await setDoc(ref,{url,status:'pending',attempt:1,submittedAt:serverTimestamp()});}
 else if(s.status==='rejected'&&s.attempt<3){await updateDoc(ref,{url,status:'pending',attempt:s.attempt+1,submittedAt:serverTimestamp()});}
 else throw Error('Esta prueba no admite otra entrega.');
 notify('Enlace enviado. La fotografía queda pendiente de revisión.');}
async function loginAdmin(form){let email=form.elements.email.value.trim(),password=form.elements.password.value;
 if(!email||!password)throw Error('Introduce correo y contraseña de administración.');
 await signInWithEmailAndPassword(A.auth,email,password);A.adminTab='general';await loadAdmin();notify('Sesión de administración iniciada.');}
async function logoutAdmin(){await signOut(A.auth);A.adminMode=false;A.allTeams=[];A.allSubs=[];A.challenges=[];A.adminSelected='';A.challengeEditor=null;A.archives=[];await signInAnonymously(A.auth);navigate('home');}
async function setupEvent(){if(!A.adminMode||A.control)throw Error('Solo puedes crear la jornada inicial si no existe otra.');await setDoc(doc(A.db,'control','main'),{status:'registration',editionNumber:1,registrationOpen:true,startedAt:null,finishedAt:null,eventName:DEFAULT_EVENT_NAME,eventDescription:DEFAULT_EVENT_DESCRIPTION,participationInstructions:DEFAULT_PARTICIPATION,durationMinutes:DEFAULT_DURATION_MINUTES,awards:DEFAULT_AWARDS,createdAt:serverTimestamp()});notify('Jornada creada: inscripciones abiertas.');}
async function updateControl(values){await updateDoc(doc(A.db,'control','main'),values);notify('Estado del concurso actualizado.');}
async function saveEventDetails(form){
 if(!A.adminMode||!A.control)throw Error('Debes iniciar sesión y crear la jornada.');
 const name=form.elements.eventName.value.trim();
 const description=form.elements.eventDescription.value.trim();
 if(name.length<3||name.length>75)throw Error('El nombre debe tener entre 3 y 75 caracteres.');
 if(description.length<10||description.length>600)throw Error('La descripción debe tener entre 10 y 600 caracteres.');
 const participation=form.elements.participationInstructions.value.trim();
 const duration=Number(form.elements.durationMinutes.value);
 if(participation.length<10||participation.length>1600)throw Error('El texto de participación debe tener entre 10 y 1600 caracteres.');
 if(!Number.isInteger(duration)||duration<5||duration>480)throw Error('Duración fuera del intervalo permitido (5–480 minutos).');
 if(A.control.status==='live'&&duration!==eventDuration())throw Error('No se puede cambiar la duración de un evento iniciado.');
 await updateDoc(doc(A.db,'control','main'),{eventName:name,eventDescription:description,participationInstructions:participation,...(A.control.status==='live'?{}:{durationMinutes:duration})});
  notify('Información del evento guardada y publicada.');
}
async function savePrizes(form){
 if(!A.adminMode||!A.control||A.control.status==='resetting')throw Error('No se pueden modificar los premios durante el cambio de edición.');
 const raw=prizeDraftFromForm();
 if(raw.length>20)throw Error('Puedes configurar como máximo 20 premios.');
 const seen=new Set();
 const awards=raw.map((p,i)=>{
  const id=String(p.id||'');
  const title=String(p.title||'').trim();
  const extra=String(p.extra||'').trim();
  const note=String(p.note||'').trim();
  const cash=Number(p.cash),materials=Number(p.materials);
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(id)||seen.has(id))throw Error(`Identificador inválido en el premio ${i+1}.`);
  seen.add(id);
  if(title.length<2||title.length>90||extra.length>180||note.length>400||
     !Number.isSafeInteger(cash)||cash<0||cash>1000000||
     !Number.isSafeInteger(materials)||materials<0||materials>100000){
    throw Error(`Comprueba los datos del premio ${i+1}.`);
  }
  return {id,title,cash,materials,extra,note};
 });
 await updateDoc(doc(A.db,'control','main'),{awards});
 A.awardDraft=null;
 notify(`Guardados ${awards.length} premios. La portada se actualizará automáticamente.`);
}
function sortedScores(scores){return [...scores].sort((a,b)=>(b.points||0)-(a.points||0)||(b.approvedCount||0)-(a.approvedCount||0)||((a.completedAt?unix(a.completedAt):Infinity)-(b.completedAt?unix(b.completedAt):Infinity))||String(a.teamName||'').localeCompare(String(b.teamName||'')));}
// Nunca publicar IDs privados de equipos como IDs de documentos de ranking.
async function publishLeaderboard(){
 if(!A.adminMode)throw Error('Solo Administración puede publicar la clasificación.');
 const docs=(await getDocs(collection(A.db,'scores'))).docs;
 const results=sortedScores(docs.map(d=>d.data())).slice(0,150).map(s=>({
   teamName:String(s.teamName||'Equipo').slice(0,60),
   points:Number(s.points||0),
   approvedCount:Number(s.approvedCount||0),
   completedAt:s.completedAt||null
 }));
 await setDoc(doc(A.db,'leaderboard','current'),{results,updatedAt:serverTimestamp()});
}

async function loadArchives(){if(!A.adminMode)return;
 const snap=await getDocs(collection(A.db,'archives'));
 A.archives=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>unix(b.archivedAt)-unix(a.archivedAt));refresh();
}
function exportDeliveries(){
 if(!A.adminMode)throw Error('Solo Administración puede exportar las entregas.');
 const teams=new Map(A.allTeams.map(t=>[t.id,t.name]));
 const tests=new Map(A.challenges.map(t=>[t.id,t.title]));
 const rows=[['Equipo','Prueba','URL','Estado','Intento','Fecha entrega','Motivo rechazo'],...A.allSubs.map(s=>[teams.get(s.teamId)||'Equipo eliminado',tests.get(s.id)||s.id,s.url||'',s.status||'',s.attempt||1,fmt(s.submittedAt),s.reason||''])];
 downloadCsv(`TRASA_Entregas_Edicion_${Number(A.control?.editionNumber||1)}.csv`,rows);
}
function downloadCsv(name,rows){
 const field=x=>{let val=String(x??'');if(/^[=+\-@\t\r]/.test(val))val="'"+val;return '"'+val.replaceAll('"','""')+'"';};
 const csv='\ufeff'+rows.map(row=>row.map(field).join(';')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=u;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(u),15000);
}
function exportArchive(id){const a=A.archives.find(a=>a.id===id);if(!a)throw Error('No se encuentra el archivo.');
 const rows=[['Posición','Equipo','Puntos','Fotografías validadas','Finalización'],...(a.results||[]).map((r,i)=>[i+1,r.teamName,r.points,r.approvedCount,fmt(r.completedAt)])];
 downloadCsv(`TRASA_Clasificacion_Edicion_${Number(a.editionNumber||1)}.csv`,rows);
}
async function deleteArchive(id){
 if(!A.adminMode)throw Error('Solo Administración puede eliminar el historial.');
 const a=A.archives.find(x=>x.id===id);
 if(!a)throw Error('No se encuentra el evento archivado.');
 const verification=window.prompt(`Eliminarás definitivamente el historial de «${a.eventName||'Evento TRASA'}» (edición ${Number(a.editionNumber||1)}).\n\nEscribe ELIMINAR para confirmar:`, '');
 if(verification===null)return;
 if(verification!=='ELIMINAR')throw Error('Operación cancelada: confirmación incorrecta.');
 await deleteDoc(doc(A.db,'archives',id));
 await loadArchives();notify('Edición eliminada del historial.');
}
async function resetEditionNumber(){
 if(!A.adminMode||!A.control||A.control.status!=='registration')throw Error('Solo se puede reiniciar la numeración mientras están abiertas las inscripciones.');
 const teams=await getDocs(collection(A.db,'teams'));
 if(!teams.empty)throw Error('Hay equipos inscritos. Elimínalos o prepara una nueva edición antes de reiniciar la numeración.');
 const answer=window.prompt('Se cambiará el número de la edición actual a 1, sin borrar el historial ni otras configuraciones. Escribe REINICIAR para confirmar:', '');
 if(answer===null)return;
 if(answer!=='REINICIAR')throw Error('Confirmación incorrecta.');
 await updateDoc(doc(A.db,'control','main'),{editionNumber:1});
 notify('La edición actual vuelve a ser la número 1.');
}
async function deleteAllArchives(){
 if(!A.adminMode)throw Error('Solo Administración puede eliminar el historial.');
 if(!A.archives.length)return;
 const verification=window.prompt(`Eliminarás DEFINITIVAMENTE las ${A.archives.length} ediciones archivadas.\nNo afecta a la edición activa.\n\nEscribe BORRAR HISTORIAL para confirmar:`, '');
 if(verification===null)return;
 if(verification!=='BORRAR HISTORIAL')throw Error('Operación cancelada: confirmación incorrecta.');
 // Consulta al servidor, no solo a los archivos cargados previamente en pantalla.
 const docs=(await getDocs(collection(A.db,'archives'))).docs;
 for(let i=0;i<docs.length;i+=400){
   const batch=writeBatch(A.db);
   docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));
   await batch.commit();
 }
 await loadArchives();notify('Historial eliminado.');
}
async function prepareNextEdition(){
 if(!A.adminMode||!A.control)throw Error('Solo la administración puede preparar otra edición.');
 if(!['finished','resetting'].includes(A.control.status))throw Error('La edición actual debe estar finalizada.');
 if(A.control.status==='finished'){
  // Archivo y bloqueo se escriben en el mismo lote: si falla, no se borra nada.
  const [teamSnap,scoreSnap]=await Promise.all([getDocs(collection(A.db,'teams')),getDocs(collection(A.db,'scores'))]);
  const teamNameMap=new Map(teamSnap.docs.map(d=>[d.id,d.data().name]));
  const scoreMap=new Map(scoreSnap.docs.map(d=>[d.id,d.data()]));
  // Se archivan también los equipos que terminaron con cero fotografías aprobadas.
  const allResults=teamSnap.docs.map(d=>({id:d.id,teamName:d.data().name,points:0,approvedCount:0,completedAt:null,...(scoreMap.get(d.id)||{})}));
  // Por seguridad se incluyen puntuaciones huérfanas de equipos eliminados manualmente.
  for(const score of scoreSnap.docs){if(!teamNameMap.has(score.id))allResults.push({id:score.id,teamName:score.data().teamName||'Equipo eliminado',...score.data()});}
  const results=sortedScores(allResults).map(r=>({teamName:r.teamName,points:Number(r.points||0),approvedCount:Number(r.approvedCount||0),completedAt:r.completedAt||null}));
  const archiveId=`edicion_${Number(A.control.editionNumber||1)}_${generateSecret().slice(0,12)}`;
  const controlRef=doc(A.db,'control','main');
  await runTransaction(A.db,async tx=>{
   const fresh=await tx.get(controlRef);
   if(!fresh.exists()||fresh.data().status!=='finished')throw Error('La edición ya está siendo preparada en otra sesión. Actualiza la página y pulsa Reanudar.');
   tx.set(doc(A.db,'archives',archiveId),{
    eventName:eventName(),eventDescription:eventDescription(),editionNumber:Number(fresh.data().editionNumber||1),
    startedAt:fresh.data().startedAt||null,finishedAt:fresh.data().finishedAt||null,
    awards:prizeSettings(),results,archivedAt:serverTimestamp()
   });
   tx.update(controlRef,{status:'resetting',registrationOpen:false,archiveId});
  });
 }
 // Al reanudar se limpian también residuos de intentos anteriores, sin tocar el archivo.
 const teams=await getDocs(collection(A.db,'teams'));
 for(const team of teams.docs){
  const t=team.data();const subs=await getDocs(collection(A.db,'teams',team.id,'submissions'));
  if(subs.size>440)throw Error(`El equipo ${t.name} tiene más de 440 entregas; requiere limpieza manual.`);
  const b=writeBatch(A.db);
  subs.docs.forEach(d=>b.delete(d.ref));
  (t.memberIds||[]).forEach(id=>b.delete(doc(A.db,'stateClaims',String(id))));
  if(t.ownerUid)b.delete(doc(A.db,'captains',t.ownerUid));
  if(t.nameKey)b.delete(doc(A.db,'teamNames',t.nameKey));
  b.delete(doc(A.db,'scores',team.id));b.delete(team.ref);await b.commit();
 }
 // Limpia también documentos huérfanos que pudieran quedar de eliminaciones fallidas.
 for(const name of ['stateClaims','captains','teamNames','scores']){
  const entries=(await getDocs(collection(A.db,name))).docs;
  for(let i=0;i<entries.length;i+=400){const batch=writeBatch(A.db);entries.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit();}
 }
 await updateDoc(doc(A.db,'control','main'),{
  status:'registration',registrationOpen:true,editionNumber:Number(A.control.editionNumber||1)+1,
  startedAt:null,finishedAt:null,archiveId:null,createdAt:serverTimestamp()
 });
 // Se mantienen premios, textos y pruebas privadas para poder reutilizarlos o editarlos.
 await publishLeaderboard();
 A.allTeams=[];A.allSubs=[];A.scores=[];A.team=null;A.teamId='';A.submissions=[];A.subSelected='';
 localStorage.removeItem(teamKey);history.replaceState(null,'',location.pathname+location.search);
 await loadAdmin();notify('Nueva edición preparada. Inscripciones abiertas y State IDs liberados.');
}
async function saveTeamEdits(form){const t=A.allTeams.find(x=>x.id===A.adminSelected);if(!t)throw Error('No has seleccionado un equipo.');
 const members=readMembers(form,4).filter(m=>m.name||m.stateId);verifyMembers(members);
 const name=form.elements.teamName.value.trim(),nameKey=slug(name),phone=form.elements.phone.value.trim();
 if(name.length<3||name.length>60||nameKey.length<3||phone.length<4)throw Error('Nombre o teléfono no válido.');
 const old=new Set(t.memberIds), now=new Set(members.map(x=>x.stateId));
 const toAdd=[...now].filter(x=>!old.has(x));const toDelete=[...old].filter(x=>!now.has(x));
 const teamRef=doc(A.db,'teams',t.id), newNameRef=doc(A.db,'teamNames',nameKey), oldNameRef=doc(A.db,'teamNames',t.nameKey);
 await runTransaction(A.db,async tx=>{
   for(const x of toAdd){const r=doc(A.db,'stateClaims',x);const s=await tx.get(r);if(s.exists()&&s.data().teamId!==t.id)throw Error(`El State ID ${x} ya pertenece a otro equipo.`);}
   if(t.nameKey!==nameKey){const s=await tx.get(newNameRef);if(s.exists()&&s.data().teamId!==t.id)throw Error('Ya existe un equipo con ese nombre.');}
   tx.update(teamRef,{name,nameKey,phone,members,memberIds:[...now]});
   for(const x of toAdd)tx.set(doc(A.db,'stateClaims',x),{teamId:t.id,ownerUid:t.ownerUid,createdAt:serverTimestamp()});
   for(const x of toDelete)tx.delete(doc(A.db,'stateClaims',x));
   if(t.nameKey!==nameKey){tx.delete(oldNameRef);tx.set(newNameRef,{teamId:t.id,createdAt:serverTimestamp()});}
 });
 const scoreRef=doc(A.db,'scores',t.id);const existingScore=await getDoc(scoreRef);
 if(existingScore.exists()){await updateDoc(scoreRef,{teamName:name});await publishLeaderboard();}
 await loadAdmin();notify('Equipo y reservas de State IDs actualizados.');}
async function deleteTeamCompletely(teamId){
 if(!A.adminMode)throw Error('Solo la administración puede eliminar equipos.');
 const t=A.allTeams.find(x=>x.id===teamId);
 if(!t)throw Error('No se encuentra el equipo solicitado.');
 const teamRef=doc(A.db,'teams',teamId);
 // Primero bloqueamos nuevas entregas: las reglas Firestore verifican `blocked`.
 await updateDoc(teamRef,{blocked:true});
 const subs=await getDocs(collection(A.db,'teams',teamId,'submissions'));
 if(subs.size>450)throw Error('Hay demasiadas entregas para borrarlas de una vez; contacta con el administrador técnico.');
 const batch=writeBatch(A.db);
 for(const entry of subs.docs)batch.delete(entry.ref);
 for(const stateId of new Set(t.memberIds||[]))batch.delete(doc(A.db,'stateClaims',stateId));
 batch.delete(doc(A.db,'captains',t.ownerUid));
 batch.delete(doc(A.db,'teamNames',t.nameKey));
 batch.delete(doc(A.db,'scores',teamId));
 batch.delete(teamRef);
 await batch.commit();
 await publishLeaderboard();
 if(A.teamId===teamId){
   unsubscribeSubmissions();unsubscribeTeam();
   A.teamId='';A.team=null;A.submissions=[];A.subSelected='';
   localStorage.removeItem(teamKey);history.replaceState(null,'',location.pathname+location.search);
 }
 A.adminSelected='';
 await loadAdmin();
 notify(`Equipo «${t.name}» eliminado; State IDs liberados.`);
}
async function review(teamId,id,approve){if(!A.adminMode)throw Error('Solo Administración puede revisar.');
 const reason=approve?'':window.prompt('Indica el motivo del rechazo (visible para el equipo):','La imagen no demuestra el objetivo solicitado.');
 if(!approve&&reason===null)return;
 const ref=doc(A.db,'teams',teamId,'submissions',id);
 await updateDoc(ref,{status:approve?'approved':'rejected',reason:approve?'':String(reason).slice(0,300),reviewedAt:serverTimestamp()});
 await recomputeScore(teamId);await loadAdmin();notify(approve?'Fotografía aprobada.':'Fotografía rechazada.');}
async function recomputeScore(teamId){const team=A.allTeams.find(t=>t.id===teamId);
 if(!team)return;const s=await getDocs(collection(A.db,'teams',teamId,'submissions'));
 const approved=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='approved');
 const points=approved.reduce((n,s)=>n+Number(A.challenges.find(c=>c.id===s.id)?.points||0),0);
 const latest=approved.reduce((m,s)=>unix(s.submittedAt)>unix(m)?s.submittedAt:m,null);
 const completedAt=(A.challenges.length>0&&approved.length===A.challenges.length)?latest:null;
 await setDoc(doc(A.db,'scores',teamId),{teamName:team.name,points,approvedCount:approved.length,completedAt,updatedAt:serverTimestamp()});
 await publishLeaderboard();}
async function saveChallenge(form){const id=form.elements.id.value.trim(),title=form.elements.title.value.trim();
 const description=form.elements.description.value.trim(),category=form.elements.category.value.trim();
 const points=Number(form.elements.points.value);
 if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)||title.length<3||title.length>110||description.length>650||!Number.isInteger(points)||points<1||points>100)throw Error('Comprueba los datos de la prueba.');
 await setDoc(doc(A.db,'challenges',id),{title,description,category,points});
 A.challengeEditor=null;await loadAdmin();notify('Prueba guardada.');}
async function importChallenges(file){if(!file)return;
 let data=JSON.parse(await file.text());if(!Array.isArray(data)||data.length<1||data.length>40)throw Error('El JSON debe tener entre 1 y 40 pruebas.');
 const ids=new Set(),batch=writeBatch(A.db);
 for(const c of data){let id=String(c.id||''),title=String(c.title||''),description=String(c.description||''),category=String(c.category||''),points=Number(c.points);
 if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)||ids.has(id)||title.length<3||description.length>650||!Number.isInteger(points)||points<1||points>100)throw Error('JSON inválido: comprueba los campos y los IDs de las pruebas.');
 ids.add(id);batch.set(doc(A.db,'challenges',id),{title,description,category,points});
 }
 await batch.commit();await loadAdmin();notify(`Se han importado ${data.length} pruebas. ¡No subas el JSON privado a GitHub!`);}

// Manejadores delegados: el HTML puede renderizarse varias veces sin perder eventos.
root.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-action]');if(!btn)return;
 const action=btn.dataset.action;
 try{
  if(['home','team','tasks','ranking','admin'].includes(action)){navigate(action);return;}
  if(action==='copyTeam'){await navigator.clipboard.writeText(urlForTeam(A.teamId));notify('Enlace privado copiado.');return;}
  if(action==='copySpecific'){await navigator.clipboard.writeText(urlForTeam(btn.dataset.id));notify('Enlace privado copiado.');return;}
  if(action==='forgetTeam'){if(confirm('¿Quitar el equipo de este navegador? No elimina la inscripción.')){localStorage.removeItem(teamKey);A.teamId='';A.team=null;A.submissions=[];unsubscribeTeam();unsubscribeSubmissions();history.replaceState(null,'',location.pathname+location.search);refresh();}return;}
  if(action==='plusMember'||action==='minusMember'){
   const form=root.querySelector('#registerTeam');if(!form)return;
   A.registrationDraft={name:form.elements.teamName.value,phone:form.elements.phone.value,members:readMembers(form,A.membersCount)};
   A.membersCount=Math.min(4,Math.max(1,A.membersCount+(action==='plusMember'?1:-1)));refresh();
   let f=root.querySelector('#registerTeam');f.elements.teamName.value=A.registrationDraft.name;f.elements.phone.value=A.registrationDraft.phone;
   A.registrationDraft.members.slice(0,A.membersCount).forEach((p,i)=>{f.elements[`player${i+1}`].value=p.name;f.elements[`id${i+1}`].value=p.stateId;});return;
  }
  if(action==='submitPhoto'){A.subSelected=btn.dataset.id;refresh();return;}
  if(action==='cancelPhoto'){A.subSelected='';refresh();return;}
  if(action==='copyAdminUID'){if(!A.user||A.user.isAnonymous)throw Error('Debes iniciar sesión como administrador.');await navigator.clipboard.writeText(A.user.uid);notify('UID copiado.');return;}
  if(action==='testAdminAccess'){
    if(!A.user||A.user.isAnonymous)throw Error('Debes iniciar sesión con la cuenta de administrador.');
    // Esta colección solo admite lectura de administradores: no se necesita que exista el documento.
    await getDoc(doc(A.db,'scores','__trasa_admin_access_test__'));
    notify('Permisos confirmados: Firebase reconoce esta cuenta como administradora.');return;
  }
  if(action==='adminLogout'){await logoutAdmin();return;}
  if(action==='adminTab'){A.awardDraft=null;A.adminTab=btn.dataset.tab;A.adminSelected='';A.challengeEditor=null;if(['revisiones','historico'].includes(A.adminTab))await loadAdmin();else refresh();return;}
  if(action==='setupEvent'){await setupEvent();return;}
  if(action==='resetEditionNumber'){loading(true);await resetEditionNumber();return;}
  if(action==='toggleRegistrations'){if(A.control?.status!=='registration')throw Error('Solo puedes cambiar inscripciones durante la fase de registro.');await updateControl({registrationOpen:!A.control.registrationOpen});return;}
  if(action==='startEvent'){if(A.control?.status!=='registration')throw Error('Primero prepara la nueva edición.');if(!confirm(`¿Iniciar el concurso ahora? Las pruebas se harán visibles y comenzará la cuenta atrás de ${eventDuration()} minutos.`))return;await updateControl({status:'live',registrationOpen:false,startedAt:serverTimestamp()});return;}
  if(action==='finishEvent'){if(!isLive())throw Error('El concurso no está en curso.');if(!confirm('¿Finalizar la jornada? Ya no se podrán entregar fotografías.'))return;await updateControl({status:'finished',registrationOpen:false,finishedAt:serverTimestamp()});return;}
  if(action==='newEdition'||action==='resumeEdition'){if(!confirm('Se archivará la clasificación y se borrarán todos los equipos, fotografías registradas y reservas de State IDs de la edición cerrada. Se conservarán las pruebas y los premios configurados. ¿Continuar?'))return;loading(true);await prepareNextEdition();return;}
  if(action==='publishLeaderboard'){loading(true);await publishLeaderboard();notify('Clasificación pública actualizada sin códigos de equipo.');return;}
  if(action==='exportArchive'){exportArchive(btn.dataset.id);return;}
  if(action==='deleteArchive'){loading(true);await deleteArchive(btn.dataset.id);return;}
  if(action==='deleteAllArchives'){loading(true);await deleteAllArchives();return;}
  if(action==='exportDeliveries'){exportDeliveries();return;}
  if(['addAward','removeAward','moveAwardUp','moveAwardDown'].includes(action)){
    if(!A.adminMode||!A.control||A.control.status==='resetting')throw Error('La edición no permite modificar premios.');
    A.awardDraft=prizeDraftFromForm();
    const i=Number(btn.dataset.index);
    if(action==='addAward'){
      if(A.awardDraft.length>=20)throw Error('Máximo 20 premios.');
      A.awardDraft.push({id:newPrizeId(),title:`Premio ${A.awardDraft.length+1}`,cash:0,materials:0,extra:'',note:''});
    }else if(action==='removeAward'){
      if(!Number.isInteger(i)||i<0||i>=A.awardDraft.length)throw Error('No existe el premio.');
      A.awardDraft.splice(i,1);
    }else{
      const j=i+(action==='moveAwardUp'?-1:1);
      if(!Number.isInteger(i)||j<0||j>=A.awardDraft.length)throw Error('No se puede cambiar ese orden.');
      [A.awardDraft[i],A.awardDraft[j]]=[A.awardDraft[j],A.awardDraft[i]];
    }
    refresh();return;
  }
  if(action==='deleteTeam'){
    const t=A.allTeams.find(x=>x.id===btn.dataset.id);
    if(!t)throw Error('No se encuentra el equipo.');
    const respuesta=window.prompt(`ATENCIÓN: borrarás «${t.name}», sus ${t.members.length} participantes, todas las fotografías y su clasificación. Se liberarán sus State IDs.\n\nPara confirmar, escribe exactamente el nombre del equipo:`, '');
    if(respuesta===null)return;
    if(respuesta!==t.name){notify('Eliminación cancelada: el nombre no coincide.');return;}
    loading(true);await deleteTeamCompletely(t.id);return;
  }
  if(action==='adminTeam'){A.adminSelected=btn.dataset.id;refresh();return;}
  if(action==='adminOpenReviews'){A.adminSelected=btn.dataset.id;A.adminTab='revisiones';await loadAdmin();return;}
  if(action==='closeTeamEditor'){A.adminSelected='';refresh();return;}
  if(action==='reviewApprove'||action==='reviewReject'){loading(true);await review(btn.dataset.team,btn.dataset.id,action==='reviewApprove');return;}
  if(action==='createChallenge'){A.challengeEditor='';refresh();return;}
  if(action==='editChallenge'){A.challengeEditor=btn.dataset.id;refresh();return;}
  if(action==='cancelChallenge'){A.challengeEditor=null;refresh();return;}
 }catch(err){problem(err)}finally{loading(false)}
});
root.addEventListener('submit',async e=>{
 e.preventDefault();let form=e.target;try{loading(true);
 if(form.id==='registerTeam')await registerTeam(form);
 else if(form.id==='accessTeam'){await openTeam(form.elements.code.value.trim());navigate('team');}
 else if(form.id==='adminLogin')await loginAdmin(form);
 else if(form.id==='editTeam')await saveTeamEdits(form);
 else if(form.id==='eventDetails')await saveEventDetails(form);
 else if(form.id==='prizesForm')await savePrizes(form);
 else if(form.id==='challengeForm')await saveChallenge(form);
 else if(form.id==='photoForm'){
   if(!confirm('¿Confirmar entrega? No podrás sustituirla hasta que Administración la rechace.'))return;
   await savePhoto(form.dataset.id,form.elements.url.value);A.subSelected='';refresh();
 }
 }catch(err){problem(err)}finally{loading(false)}
});
root.addEventListener('change',async e=>{
 try{
  if(e.target.id==='reviewTeam'){A.adminSelected=e.target.value;refresh();}
  if(e.target.id==='importChallenges'){loading(true);await importChallenges(e.target.files?.[0]);}
 }catch(err){problem(err)}finally{loading(false)}
});
function bindForms(){}

start();
