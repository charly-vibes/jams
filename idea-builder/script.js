// Architekt - Idea Builder
// A structured thinking workspace for exploring ideas through
// topics, topoi, combinatorics, and argumentative frameworks.

// PWA
(function(){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FAF8F5"/><polygon points="256,96 416,256 256,416 96,256" fill="#B8623B" opacity="0.85"/><polygon points="256,176 336,256 256,336 176,256" fill="#FAF8F5"/><circle cx="256" cy="256" r="16" fill="#B8623B"/></svg>`;
  const iU=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const l=document.createElement('link');l.rel='apple-touch-icon';l.href=iU;document.head.appendChild(l);
  const m={name:'Architekt',short_name:'Architekt',start_url:location.href,display:'standalone',background_color:'#FAF8F5',theme_color:'#FAF8F5',icons:[{src:iU,sizes:'512x512',type:'image/svg+xml',purpose:'any maskable'}]};
  const ml=document.createElement('link');ml.rel='manifest';ml.href=URL.createObjectURL(new Blob([JSON.stringify(m)],{type:'application/json'}));document.head.appendChild(ml);
  if('serviceWorker'in navigator){const sw=`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));`;navigator.serviceWorker.register(URL.createObjectURL(new Blob([sw],{type:'application/javascript'}))).catch(()=>{});}
})();

const K='architekt_v2';
const load=()=>{try{return JSON.parse(localStorage.getItem(K))||{topics:[],cur:null}}catch{return{topics:[],cur:null}}};
const save=d=>localStorage.setItem(K,JSON.stringify(d));
const getT=()=>{const d=load();return d.topics.find(t=>t.id===d.cur)||null};
const gid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>{if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML};
const fdt=ts=>{const d=new Date(ts),mn=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];return`${d.getDate()} ${mn[d.getMonth()]}`};

function toast(m){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),2200);}
function modal(h){document.getElementById('modalBox').innerHTML=h;document.getElementById('modalBg').classList.add('show');}
function closeModal(){document.getElementById('modalBg').classList.remove('show');}
document.getElementById('modalBg').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal()});

let tool='ideas';
let structStep=0;

function openTopic(id){
  const d=load();d.cur=id;save(d);const t=getT();if(!t)return;
  document.getElementById('wsTitle').textContent=t.name;
  document.getElementById('homeView').className='view hidden-left';
  document.getElementById('wsView').className='view active';
  tool='ideas';structStep=0;syncTool();renderTool();
}

function goHome(){
  document.getElementById('homeView').className='view active';
  document.getElementById('wsView').className='view hidden-right';
  renderTopics();
}

document.querySelectorAll('.tool-btn').forEach(b=>b.addEventListener('click',()=>{
  tool=b.dataset.tool;syncTool();renderTool();
}));

function syncTool(){
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  document.querySelectorAll('.ws-panel').forEach(p=>p.classList.toggle('active',p.id==='wp-'+tool));
  document.getElementById('wsScroll').scrollTop=0;
}

function renderTool(){
  if(tool==='ideas') renderIdeas();
  else if(tool==='explore') renderExplore();
}

// TOPICS
const nti=document.getElementById('newTopic');
nti.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const n=nti.value.trim();if(!n)return;
    const d=load();
    d.topics.unshift({id:gid(),name:n,at:Date.now(),ideas:[],topoi:{},combi:{a:[],b:[],c:[]},combiH:[],struct:{m:'toulmin',s:{}}});
    save(d);nti.value='';renderTopics();toast('Tópico creado');
  }
});

function renderTopics(){
  const d=load(),w=document.getElementById('tListW');
  if(!d.topics.length){
    w.innerHTML='<div class="empty-state"><div class="empty-icon">A</div><h3>Tu espacio está vacío</h3><p>Escribe un tema arriba y presiona Enter. Cada tópico es un espacio enfocado para explorar una idea.</p></div>';
    return;
  }
  w.innerHTML='<div class="section-label">Tus tópicos</div><div class="topic-list">'+d.topics.map(t=>`
    <div class="topic-row" onclick="openTopic('${t.id}')">
      <div class="topic-dot"></div>
      <div class="topic-info">
        <div class="topic-name">${esc(t.name)}</div>
        <div class="topic-meta">${t.ideas.length} idea${t.ideas.length!==1?'s':''} · ${fdt(t.at)}</div>
      </div>
      <button class="topic-row-del" onclick="event.stopPropagation();delTopic('${t.id}')">✕</button>
      <div class="topic-arrow">›</div>
    </div>`).join('')+'</div>';
}

function delTopic(id){
  modal('<h3>Eliminar tópico</h3><p>Se perderán todas las ideas y notas. Esta acción no se puede deshacer.</p><div class="modal-actions"><button class="sm-btn" onclick="closeModal()">Cancelar</button><button class="sm-btn danger" onclick="confirmDel(\''+id+'\')">Eliminar</button></div>');
}
function confirmDel(id){
  const d=load();d.topics=d.topics.filter(t=>t.id!==id);if(d.cur===id)d.cur=null;save(d);closeModal();renderTopics();toast('Eliminado');
}

// IDEAS
function renderIdeas(){
  const t=getT();if(!t)return;
  const el=document.getElementById('wIdeas');
  el.innerHTML=`
    <div class="idea-input-wrap">
      <textarea class="idea-input" id="ideaTxt" placeholder="Captura un pensamiento..." rows="1"></textarea>
      <button class="idea-send" id="ideaSend" onclick="addIdea()">↑</button>
      <button class="tag-toggle" id="tagToggle" onclick="toggleTags()">#</button>
    </div>
    <div class="idea-tags-row" id="ideaTagsRow">
      <input class="idea-tags-field" id="ideaTagsF" placeholder="#etiquetas separadas por espacio">
    </div>
    ${t.ideas.length?'<input class="search-field" id="ideaSrch" placeholder="Buscar..." oninput="filterIdeas()">':''}
    <div class="ideas-list" id="ideasList"></div>`;
  renderIL();
  const txt=document.getElementById('ideaTxt');
  txt.addEventListener('focus',()=>{document.getElementById('ideaSend').classList.add('vis');});
  txt.addEventListener('blur',()=>{setTimeout(()=>{if(!txt.value.trim()){document.getElementById('ideaSend').classList.remove('vis');}},200);});
  txt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))addIdea();});
  txt.addEventListener('input',()=>{txt.style.height='auto';txt.style.height=txt.scrollHeight+'px';});
}

function toggleTags(){
  const row=document.getElementById('ideaTagsRow');
  const btn=document.getElementById('tagToggle');
  row.classList.toggle('vis');
  btn.classList.toggle('active');
}

function renderIL(){
  const t=getT();if(!t)return;
  const q=(document.getElementById('ideaSrch')||{}).value||'';const ql=q.toLowerCase();
  const f=t.ideas.filter(i=>i.text.toLowerCase().includes(ql)||i.tags.some(x=>x.toLowerCase().includes(ql)));
  const el=document.getElementById('ideasList');
  if(!f.length){
    el.innerHTML=t.ideas.length?'<div class="empty-state"><p>Sin resultados</p></div>'
      :'<div class="empty-state"><div class="empty-icon">✦</div><h3>Empieza a pensar</h3><p>Escribe arriba para capturar tu primera idea. Cada nota es un pensamiento atómico y autónomo.</p></div>';
    return;
  }
  el.innerHTML=f.map(i=>`
    <div class="idea-card">
      <button class="idea-del" onclick="delIdea('${i.id}')">✕</button>
      <div class="idea-text">${esc(i.text)}</div>
      <div class="idea-foot">
        <div class="idea-tags">${i.tags.map(x=>'<span class="idea-tag">#'+esc(x)+'</span>').join('')}</div>
        <div class="idea-time">${fdt(i.at)}</div>
      </div>
    </div>`).join('');
}

function addIdea(){
  const txt=document.getElementById('ideaTxt'),tf=document.getElementById('ideaTagsF');
  const v=txt.value.trim();if(!v)return;
  const tags=tf.value.trim().split(/\s+/).map(x=>x.replace(/^#/,'')).filter(Boolean);
  const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;
  t.ideas.unshift({id:gid(),text:v,tags,at:Date.now()});save(d);
  txt.value='';tf.value='';txt.style.height='auto';renderIdeas();toast('Idea guardada');
  setTimeout(()=>{const t=document.getElementById('ideaTxt');if(t)t.focus();},100);
}
function delIdea(id){const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;t.ideas=t.ideas.filter(i=>i.id!==id);save(d);renderIL();toast('Eliminada');}
function filterIdeas(){renderIL();}

// TOPOI - exclusive accordion: only one open at a time
const TOPOI=[
  {k:'def',n:'Definición',q:['¿Qué es exactamente?','¿De qué partes se compone?','¿Cómo se entiende universalmente?']},
  {k:'comp',n:'Comparación',q:['¿A qué se parece?','¿En qué se diferencia radicalmente?','¿Qué es lo opuesto?']},
  {k:'rel',n:'Relación',q:['¿Cuál es la causa?','¿Qué consecuencias genera?','¿Qué depende de esto?']},
  {k:'circ',n:'Circunstancias',q:['¿Qué ha ocurrido antes?','¿Qué podría suceder?','¿Qué lo hace viable?']},
  {k:'test',n:'Testimonio',q:['¿Qué dicen los expertos?','¿Qué revela la experiencia?','¿Cómo respondería un oponente?']}
];

function renderTopoiInto(container){
  const t=getT();if(!t)return;if(!t.topoi)t.topoi={};
  container.innerHTML=
    '<div class="sec-desc">Explora tu tema a través de los cinco lugares de invención argumentativa.</div>'+
    TOPOI.map((tp,i)=>`
      <div class="topos" id="tp-${tp.k}">
        <div class="topos-head" onclick="togTp('${tp.k}')">
          <div class="topos-pip c${i}">${tp.n[0]}</div>
          <div class="topos-label">${tp.n}</div>
          <div class="topos-chev">▾</div>
        </div>
        <div class="topos-body"><div class="topos-inner">
          <div class="topos-prompts">${tp.q.map(q=>'<button class="topos-prompt" onclick="insTp(\''+tp.k+'\',this)">'+q+'</button>').join('')}</div>
          <textarea class="topos-area" placeholder="Tus reflexiones..." oninput="saveTp(\'${tp.k}\',this.value)">${esc(t.topoi[tp.k]||'')}</textarea>
        </div></div>
      </div>`).join('');
}

function renderTopoi(){
  const el=document.getElementById('wTopoi')||document.getElementById('expTopoi');
  if(el) renderTopoiInto(el);
}

function togTp(k){
  const el=document.getElementById('tp-'+k);
  const wasOpen=el.classList.contains('open');
  document.querySelectorAll('.topos.open').forEach(t=>t.classList.remove('open'));
  if(!wasOpen){
    el.classList.add('open');
    setTimeout(()=>{const ta=el.querySelector('.topos-area');if(ta)ta.focus();},350);
  }
}
function insTp(k,el){
  const ta=document.querySelector('#tp-'+k+' .topos-area');
  ta.value=ta.value?ta.value+'\n\n'+el.textContent+'\n':el.textContent+'\n';
  ta.focus();saveTp(k,ta.value);
}
function saveTp(k,v){const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;if(!t.topoi)t.topoi={};t.topoi[k]=v;save(d);}

// COMBI - history collapsed by default
function renderCombiInto(container){
  const t=getT();if(!t)return;
  if(!t.combi)t.combi={a:[],b:[],c:[]};if(!t.combiH)t.combiH=[];
  const rings=[{k:'a',l:'Sujetos / Temas'},{k:'b',l:'Atributos / Cualidades'},{k:'c',l:'Contextos / Relaciones'}];
  container.innerHTML=
    '<div class="sec-desc">Combina conceptos de tres anillos para generar premisas originales.</div>'+
    rings.map(r=>`
      <div class="combi-ring">
        <div class="combi-ring-label"><span class="combi-dot ${r.k}"></span>${r.l}</div>
        <div class="combi-tokens">
          ${(t.combi[r.k]||[]).map((v,i)=>'<span class="combi-token">'+esc(v)+'<button class="combi-token-x" onclick="rmTk(\''+r.k+'\','+i+')">×</button></span>').join('')}
          <input class="combi-add-input" placeholder="Añadir..." onkeydown="addTk(event,\'${r.k}\',this)">
        </div>
      </div>`).join('')+
    '<div class="combi-gen-wrap"><button class="combi-gen-btn" onclick="genCombi()">Generar combinación</button></div>'+
    '<div id="combiOut"></div>'+
    (t.combiH.length?
      '<button class="combi-hist-toggle" onclick="togHist()">Historial ('+t.combiH.length+')</button>'+
      '<div class="combi-hist" id="combiHist">'+t.combiH.map(h=>'<div class="combi-hist-item"><div class="combi-hist-f">'+esc(h.f)+'</div>'+esc(h.t)+'</div>').join('')+'</div>'
    :'');
}

function renderCombi(){
  const el=document.getElementById('wCombi')||document.getElementById('expCombi');
  if(el) renderCombiInto(el);
}

function togHist(){
  const el=document.getElementById('combiHist');
  if(el) el.classList.toggle('open');
}

function addTk(e,r,inp){if(e.key!=='Enter')return;const v=inp.value.trim();if(!v)return;const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;if(!t.combi[r])t.combi[r]=[];t.combi[r].push(v);save(d);inp.value='';renderExplore();}
function rmTk(r,i){const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;t.combi[r].splice(i,1);save(d);renderExplore();}

function genCombi(){
  const t=getT();if(!t)return;const{a,b,c}=t.combi;
  if(!a.length||!b.length||!c.length){toast('Añade al menos un concepto en cada anillo');return;}
  const pk=arr=>arr[Math.floor(Math.random()*arr.length)];
  const va=pk(a),vb=pk(b),vc=pk(c);
  const f=va+' + '+vb+' + '+vc;
  const txt='¿Cómo se relaciona "'+va+'" con "'+vb+'" en el contexto de "'+vc+'"?';
  document.getElementById('combiOut').innerHTML=
    '<div class="combi-output"><div class="combi-output-f">'+esc(f)+'</div><div class="combi-output-q">'+esc(txt)+'</div>'+
    '<div class="combi-output-btns"><button class="sm-btn" onclick="genCombi()">Otra</button>'+
    '<button class="sm-btn primary" onclick="saveCombi()">Guardar</button></div></div>';
  window._lastCombi={f,t:txt};
}

function saveCombi(){
  if(!window._lastCombi)return;
  const d=load(),tp=d.topics.find(x=>x.id===d.cur);if(!tp)return;
  tp.combiH.unshift({f:window._lastCombi.f,t:window._lastCombi.t,at:Date.now()});save(d);renderExplore();toast('Guardada');
}

// STRUCT - step by step: one slot at a time
const MODELS={
  toulmin:{n:'Toulmin',s:[{k:'claim',l:'Reivindicación',p:'Tu tesis principal...'},{k:'grounds',l:'Evidencia',p:'Hechos que la apoyan...'},{k:'warrant',l:'Garantía',p:'La conexión lógica...'},{k:'backing',l:'Respaldo',p:'Apoyo adicional...'},{k:'qualifier',l:'Calificador',p:'"Presumiblemente"...'},{k:'rebuttal',l:'Reserva',p:'Objeciones posibles...'}]},
  polya:{n:'Polya',s:[{k:'u',l:'Comprender',p:'¿Cuál es el objetivo?'},{k:'p',l:'Planificar',p:'Patrones similares...'},{k:'e',l:'Ejecutar',p:'Hilar ideas...'},{k:'r',l:'Revisar',p:'¿Se sostiene?'}]},
  narrative:{n:'Narrativa',s:[{k:'hook',l:'Gancho',p:'Lo que atrapa...'},{k:'prob',l:'Problema',p:'Conflicto central...'},{k:'bg',l:'Contexto',p:'Información de fondo...'},{k:'comp',l:'Complicación',p:'Lo difícil...'},{k:'act',l:'Acción',p:'Decisiones...'},{k:'crit',l:'Momento crítico',p:'Punto de giro...'},{k:'res',l:'Resolución',p:'Cómo se transforma...'}]},
  free:{n:'Libre',s:[{k:'i',l:'Introducción',p:'Punto de entrada...'},{k:'d1',l:'Desarrollo 1',p:''},{k:'d2',l:'Desarrollo 2',p:''},{k:'c',l:'Conclusión',p:'Cierre y síntesis...'}]}
};

function renderStructInto(container){
  const t=getT();if(!t)return;if(!t.struct)t.struct={m:'toulmin',s:{}};
  const mod=MODELS[t.struct.m]||MODELS.toulmin;
  if(structStep>=mod.s.length) structStep=mod.s.length-1;
  const s=mod.s[structStep];
  container.innerHTML=
    '<div class="struct-models">'+Object.entries(MODELS).map(([k,v])=>'<button class="struct-pill'+(k===t.struct.m?' active':'')+'" onclick="setModel(\''+k+'\')">'+v.n+'</button>').join('')+'</div>'+
    '<div class="struct-steps">'+mod.s.map((_,i)=>{
      const cls=['struct-step'];
      if(i===structStep) cls.push('active');
      else if(t.struct.s[mod.s[i].k]) cls.push('filled');
      return '<button class="'+cls.join(' ')+'" onclick="goStep('+i+')"></button>';
    }).join('')+'</div>'+
    '<div class="struct-focus-slot">'+
      '<div class="struct-focus-head"><span class="struct-focus-n">'+(structStep+1)+'</span>'+esc(s.l)+'</div>'+
      '<textarea class="struct-focus-area" placeholder="'+esc(s.p)+'" oninput="saveSlot(\''+s.k+'\',this.value)">'+esc(t.struct.s[s.k]||'')+'</textarea>'+
    '</div>'+
    '<div class="struct-nav">'+
      (structStep>0?'<button class="sm-btn" onclick="goStep('+(structStep-1)+')">← '+esc(mod.s[structStep-1].l)+'</button>':'<span></span>')+
      '<div class="struct-counter">'+(structStep+1)+' / '+mod.s.length+'</div>'+
      (structStep<mod.s.length-1?'<button class="sm-btn primary" onclick="goStep('+(structStep+1)+')">'+esc(mod.s[structStep+1].l)+' →</button>':'<span></span>')+
    '</div>';
}

function renderStruct(){
  const el=document.getElementById('wStruct')||document.getElementById('expStruct');
  if(el) renderStructInto(el);
}

function goStep(i){structStep=i;renderExplore();}
function setModel(m){const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;t.struct.m=m;structStep=0;save(d);renderExplore();}
function saveSlot(k,v){const d=load(),t=d.topics.find(x=>x.id===d.cur);if(!t)return;t.struct.s[k]=v;save(d);}

// EXPLORE - unified panel with collapsible sections
function renderExplore(){
  const t=getT();if(!t)return;
  const el=document.getElementById('wExplore');
  el.innerHTML=
    '<div class="explore-section open" id="exp-topoi">'+
      '<div class="explore-section-title" onclick="togExp(\'topoi\')"><span class="chev">›</span>Topoi</div>'+
      '<div class="explore-section-body"><div id="expTopoi"></div></div>'+
    '</div>'+
    '<div class="explore-section" id="exp-combi">'+
      '<div class="explore-section-title" onclick="togExp(\'combi\')"><span class="chev">›</span>Combinar</div>'+
      '<div class="explore-section-body"><div id="expCombi"></div></div>'+
    '</div>'+
    '<div class="explore-section" id="exp-struct">'+
      '<div class="explore-section-title" onclick="togExp(\'struct\')"><span class="chev">›</span>Estructura</div>'+
      '<div class="explore-section-body"><div id="expStruct"></div></div>'+
    '</div>';
  renderTopoiInto(document.getElementById('expTopoi'));
  renderCombiInto(document.getElementById('expCombi'));
  renderStructInto(document.getElementById('expStruct'));
}

function togExp(s){
  const el=document.getElementById('exp-'+s);
  if(el) el.classList.toggle('open');
}

// Overflow menu
function showOverflow(){
  modal('<h3>Opciones</h3><div class="modal-actions" style="flex-direction:column;gap:10px;align-items:stretch"><button class="sm-btn" onclick="expAll();closeModal()">Exportar datos</button><button class="sm-btn" onclick="document.getElementById(\'impF\').click();closeModal()">Importar datos</button></div>');
}

// Export/Import
function expAll(){
  const b=new Blob([JSON.stringify(load(),null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='architekt_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('Exportado');
}
document.getElementById('impF').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{const d=JSON.parse(r.result);if(d.topics){save(d);renderTopics();toast('Importado');}else toast('Formato inválido');}catch{toast('Error');}};
  r.readAsText(f);e.target.value='';
});

renderTopics();