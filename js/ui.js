// ui.js — manipulación DOM, usa textContent para evitar XSS
import { sumDayEntries, NUTRIENT_LABELS } from './nutrition.js';
import { formatDateLong } from './history.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

export function escapeText(s){ return String(s); } // usamos textContent, no innerHTML

export function renderSummary(entries){
  const totals=sumDayEntries(entries);
  const grid=$('#summary-grid');
  grid.innerHTML='';
  const order=['calories','protein','carbohydrates','fat','fiber','sugar','sodium'];
  const icons={calories:'🔥', protein:'💪', carbohydrates:'🍞', fat:'🥑', fiber:'🌾', sugar:'🍬', sodium:'🧂'};
  const units={calories:'kcal', protein:'g', carbohydrates:'g', fat:'g', fiber:'g', sugar:'g', sodium:'mg'};
  for(const k of order){
    const div=document.createElement('div');
    div.className='summary-item';
    const kk=document.createElement('div'); kk.className='k'; kk.textContent=`${icons[k]} ${NUTRIENT_LABELS[k]}`;
    const vv=document.createElement('div'); vv.className='v'; vv.textContent=String(totals[k]);
    const uu=document.createElement('div'); uu.className='u'; uu.textContent=units[k];
    div.append(kk,vv,uu); grid.appendChild(div);
  }
  // progreso calorías (meta 2000 kcal como referencia visual)
  const kcal=totals.calories;
  const pct=Math.min(100, Math.round(kcal/2000*100));
  const bar=$('#progress-calories'); if(bar) bar.style.width=pct+'%';
  const txt=$('#summary-calories-text'); if(txt) txt.textContent=`${kcal} kcal (${pct}% de 2000)`;
}

export function renderEntries(entries, onEdit, onDelete){
  const list=$('#entries-list');
  const empty=$('#empty-state');
  list.innerHTML='';
  if(entries.length===0){
    empty.classList.remove('hidden'); empty.hidden=false; empty.style.display='';
    return;
  }
  empty.classList.add('hidden'); empty.hidden=true; empty.style.display='none';
  for(const e of entries){
    const li=document.createElement('li');
    li.className='entry-item';
    // top
    const top=document.createElement('div'); top.className='entry-top';
    const left=document.createElement('div');
    const name=document.createElement('div'); name.className='entry-name'; name.textContent=e.name;
    const sub=document.createElement('div'); sub.className='entry-sub';
    sub.textContent=[e.brand && `Marca: ${e.brand}`, e.category && e.category, `${e.quantity} ${e.unit} • ${e.servingSize}${e.servingUnit} por porción`, e.consumedAt && `⏰ ${e.consumedAt}`].filter(Boolean).join(' • ');
    left.append(name,sub);
    const kcal=document.createElement('div'); kcal.style.fontWeight='800'; kcal.textContent=`${e.nutrientsTotal.calories} kcal`;
    top.append(left,kcal);
    // nutrients
    const nuts=document.createElement('div'); nuts.className='entry-nutrients';
    for(const k of ['protein','carbohydrates','fat','fiber','sugar','sodium']){
      const sp=document.createElement('span'); sp.textContent=`${NUTRIENT_LABELS[k]}: ${e.nutrientsTotal[k]}`;
      nuts.appendChild(sp);
    }
    // actions
    const acts=document.createElement('div'); acts.className='entry-actions';
    const btnEdit=document.createElement('button'); btnEdit.className='btn btn-ghost btn-small'; btnEdit.textContent='Editar'; btnEdit.setAttribute('aria-label', `Editar ${e.name}`);
    btnEdit.addEventListener('click', ()=> onEdit(e));
    const btnDel=document.createElement('button'); btnDel.className='btn btn-danger btn-small'; btnDel.textContent='Eliminar';
    btnDel.addEventListener('click', ()=> onDelete(e));
    acts.append(btnEdit, btnDel);
    li.append(top, nuts, acts);
    list.appendChild(li);
  }
}

export function renderSearchResults(foods, onSelect){
  const ul=$('#search-results');
  ul.innerHTML='';
  if(!foods.length){
    const li=document.createElement('li'); li.textContent='Sin resultados.'; li.style.color='var(--muted)'; li.style.padding='8px';
    ul.appendChild(li); return;
  }
  foods.forEach((f, idx)=>{
    const li=document.createElement('li');
    li.className='search-results-item result-item';
    li.tabIndex=0; li.setAttribute('role','option');
    li.addEventListener('click', ()=> onSelect(f));
    li.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onSelect(f);} });
    const title=document.createElement('div'); title.className='result-title'; title.textContent=f.name;
    const meta=document.createElement('div'); meta.className='result-meta';
    const m1=document.createElement('span'); m1.textContent=f.brand?`Marca: ${f.brand}`:'Sin marca';
    const m2=document.createElement('span'); m2.textContent=f.category||'';
    const m3=document.createElement('span'); m3.textContent=`Porción: ${f.servingSize}${f.servingUnit}`;
    meta.append(m1); if(f.category) meta.append(m2); meta.append(m3);
    const nuts=document.createElement('div'); nuts.className='result-nutrients';
    const n=f.nutrientsPerServing;
    const parts=[`🔥 ${n.calories} kcal`, `P ${n.protein}g`, `C ${n.carbohydrates}g`, `G ${n.fat}g`];
    parts.forEach(t=>{ const s=document.createElement('span'); s.textContent=t; nuts.appendChild(s); });
    li.append(title, meta, nuts);
    ul.appendChild(li);
  });
}

export function renderSelectedFood(food, quantity){
  const wrap=$('#selected-info');
  wrap.innerHTML='';
  const h=document.createElement('div'); h.style.fontWeight='800'; h.textContent=food.name;
  const p=document.createElement('div'); p.style.color='var(--muted)'; p.style.fontSize='.9rem';
  p.textContent=[food.brand && `Marca: ${food.brand}`, food.category, `Porción base: ${food.servingSize}${food.servingUnit}`].filter(Boolean).join(' • ');
  wrap.append(h,p);
  // preview nutrients
  const preview=$('#preview-nutrients');
  preview.innerHTML='';
  const per=food.nutrientsPerServing;
  const q=Number(quantity)||0;
  const items=[
    ['Calorías', per.calories*q, 'kcal'],
    ['Proteínas', per.protein*q, 'g'],
    ['Carbs', per.carbohydrates*q, 'g'],
    ['Grasas', per.fat*q, 'g'],
    ['Fibra', per.fiber*q, 'g'],
    ['Azúcares', per.sugar*q, 'g'],
    ['Sodio', per.sodium*q, 'mg'],
  ];
  for(const [label,val,unit] of items){
    const d=document.createElement('div'); d.className='p';
    const b=document.createElement('b'); b.textContent=`${Math.round(val*100)/100} ${unit}`;
    const s=document.createElement('span'); s.textContent=label;
    d.append(b,s); preview.appendChild(d);
  }
}

export function renderHistory(historyModel, currentIso, onPick){
  const ul=$('#history-list');
  const empty=$('#history-empty');
  ul.innerHTML='';
  if(historyModel.length===0){ empty.hidden=false; empty.style.display=''; return; }
  empty.hidden=true; empty.style.display='none';
  for(const h of historyModel){
    const li=document.createElement('li'); li.className='history-item';
    if(h.date===currentIso) li.classList.add('active');
    li.tabIndex=0;
    li.addEventListener('click', ()=> onPick(h.date));
    li.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') {e.preventDefault(); onPick(h.date);} });
    const left=document.createElement('div');
    const d=document.createElement('div'); d.style.fontWeight='700'; d.textContent=formatDateLong(h.date);
    const c=document.createElement('div'); c.className='history-kpis'; c.textContent=`${h.count} alimentos • ${h.totals.calories} kcal`;
    left.append(d,c);
    const kpis=document.createElement('div'); kpis.className='history-kpis'; kpis.textContent=`P ${h.totals.protein}g • C ${h.totals.carbohydrates}g • G ${h.totals.fat}g`;
    li.append(left,kpis);
    ul.appendChild(li);
  }
}

export function setSearchStatus(msg, type=''){
  const el=$('#search-status');
  el.textContent=msg||'';
  el.className='search-status '+(type||'');
}

export function showToast(msg, kind=''){
  const t=$('#toast');
  t.textContent=msg;
  t.className='toast '+(kind||'');
  t.hidden=false; t.style.display='block';
  clearTimeout(showToast._t);
  showToast._t=setTimeout(()=>{ t.hidden=true; t.style.display='none'; }, 2600);
}

export function updateDateLabel(iso){
  const el=$('#date-label');
  const d=new Date(iso+'T12:00:00');
  const today=new Date(); today.setHours(12,0,0,0);
  const isoToday=today.toISOString().slice(0,10);
  // corregir por zona: usar formato local ya dado
  let label=d.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  if(iso===isoToday) label=`Hoy — ${label}`;
  el.textContent=label;
}
