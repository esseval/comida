// app.js — orquestación principal
import { loadData, saveData, getDay, addEntry, removeEntry, clearDay, duplicateDay, createEntryFromFood, isStorageAvailable } from './storage.js';
import { searchFoods, debounce, hasCreds, getFoodDetail } from './api.js';
import { renderSummary, renderEntries, renderSearchResults, renderSelectedFood, renderHistory, setSearchStatus, showToast, updateDateLabel } from './ui.js';
import { buildHistoryModel, isoToday, addDays } from './history.js';
import { exportJSON, exportCSV, importData } from './import-export.js';
import { initThreeBackground } from './three-background.js';

let data, currentIso, selectedFood=null;
let searchPage=1, lastQuery='', lastFoods=[];
const PAGE_SIZE=10;

function $(s){ return document.querySelector(s); }

async function init(){
  // tema
  const savedTheme = (()=>{ try{ return JSON.parse(localStorage.getItem('nutri-diary-data'))?.settings?.theme; }catch{return null}})();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark':'light');
  setTheme(theme);

  // storage
  const { data: loaded, error } = loadData();
  data=loaded;
  if(error) showToast(error,'error');
  if(!isStorageAvailable()){
    showToast('localStorage no disponible: tus datos no se guardarán al recargar.','error');
  }

  currentIso = isoToday();
  $('#date-picker').value = currentIso;
  updateDateLabel(currentIso);

  // three background (no bloquea)
  initThreeBackground().catch(()=>{});

  bindEvents();
  refreshDay();
  refreshHistory();
  // Check proxy.php (Apache) — mismo origen, sin Node
  try{
    const r = await fetch('proxy.php?action=health').then(x=>x.json()).catch(()=>null);
    if(!r?.hasCreds){
      setSearchStatus('Falta config.php en el servidor. Copia config.php.example a config.php y completa tus credenciales FatSecret.','error');
    } else {
      setSearchStatus('Conectado la API de FatSecret.com','');
    }
  }catch{}

  // hora actual por defecto
  const now=new Date(); $('#input-time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  $('#theme-icon').textContent = t==='dark' ? '☀️' : '🌙';
  // persistir
  try{
    const raw=JSON.parse(localStorage.getItem('nutri-diary-data')||'{}');
    if(raw && raw.settings){ raw.settings.theme=t; localStorage.setItem('nutri-diary-data', JSON.stringify(raw)); }
    else if(data){ data.settings.theme=t; saveData(data); }
  }catch{}
}

function bindEvents(){
  // tema
  $('#btn-theme').addEventListener('click', ()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    setTheme(cur==='dark'?'light':'dark');
  });
  // fecha
  $('#date-picker').addEventListener('change', e=>{
    const v=e.target.value; if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    currentIso=v; updateDateLabel(currentIso); refreshDay(); refreshHistory();
  });
  $('#btn-prev-day').addEventListener('click', ()=> navDay(-1));
  $('#btn-next-day').addEventListener('click', ()=> navDay(1));
  $('#btn-today').addEventListener('click', ()=>{
    currentIso=isoToday(); $('#date-picker').value=currentIso; updateDateLabel(currentIso); refreshDay(); refreshHistory();
  });
  // búsqueda
  const debouncedSearch = debounce(handleSearch, 500);
  $('#search-input').addEventListener('input', e=>{
    const q=e.target.value.trim();
    if(q.length<2){ setSearchStatus('Escribe al menos 2 caracteres',''); return; }
    debouncedSearch(q);
  });
  $('#search-input').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); handleSearch(e.target.value.trim()); }
  });
  $('#btn-search').addEventListener('click', ()=> handleSearch($('#search-input').value.trim()));
  $('#btn-more').addEventListener('click', ()=> {
    searchPage++; handleSearch(lastQuery, true);
  });
  // selección
  $('#add-form').addEventListener('submit', onAdd);
  $('#btn-cancel-selection').addEventListener('click', clearSelection);
  $('#input-quantity').addEventListener('input', updatePreview);
  $('#input-unit').addEventListener('input', updatePreview);
  // entradas
  $('#btn-clear-day').addEventListener('click', onClearDay);
  $('#btn-duplicate').addEventListener('click', openDuplicate);
  // datos dialog
  $('#btn-data').addEventListener('click', ()=> $('#data-dialog').showModal());
  $('#btn-export-json').addEventListener('click', ()=> { exportJSON(data); showToast('JSON exportado','success'); });
  $('#btn-export-csv').addEventListener('click', ()=> { exportCSV(data); showToast('CSV exportado','success'); });
  $('#btn-import').addEventListener('click', onImport);
  $('#btn-wipe-all').addEventListener('click', onWipeAll);
  // duplicate dialog
  $('#duplicate-form').addEventListener('submit', onDuplicateSubmit);
  $('#btn-dup-cancel').addEventListener('click', ()=> $('#duplicate-dialog').close());
  // Ya no hay inputs de Client Secret en el frontend (ver index.html)
  // dialog backdrop close on click outside? native dialog handles.
}

function navDay(delta){
  currentIso=addDays(currentIso, delta);
  $('#date-picker').value=currentIso;
  updateDateLabel(currentIso);
  refreshDay(); refreshHistory();
}

function refreshDay(){
  const day=getDay(data, currentIso);
  renderSummary(day.entries);
  renderEntries(day.entries, onEditEntry, onDeleteEntry);
  // historial highlight
  refreshHistory();
}

function refreshHistory(){
  const model=buildHistoryModel(data);
  renderHistory(model, currentIso, (iso)=>{
    currentIso=iso; $('#date-picker').value=iso; updateDateLabel(iso); refreshDay();
    window.scrollTo({top:0, behavior:'smooth'});
  });
}

async function handleSearch(query, append=false){
  if(!query){ setSearchStatus('Escribe un alimento',''); return; }
  if(!append){ searchPage=1; lastQuery=query; lastFoods=[]; }
  else { query=lastQuery; }
  setSearchStatus('Buscando en FatSecret (AR)…','loading');
  if(!append) $('#search-results').innerHTML='';
  try{
    const res=await searchFoods(query, {page: searchPage, pageSize: PAGE_SIZE});
    const foods = Array.isArray(res?.foods) ? res.foods : [];
    const totalHits = Number(res?.totalHits ?? foods.length);
    if(!append) lastFoods=foods;
    else lastFoods=lastFoods.concat(foods);
    renderSearchResults(lastFoods, onSelectFood);
    const srcLabel = 'FatSecret AR';
    if(lastFoods.length===0 && !append) setSearchStatus('Sin resultados. Prueba otro término (ej: asado, yerba, milanesa).','error');
    else setSearchStatus(`Resultados (${srcLabel}) — ${lastFoods.length}${totalHits?` de ${totalHits}`:''}`, '');
    const more=$('#search-pagination');
    if(foods.length===PAGE_SIZE && totalHits > lastFoods.length) more.hidden=false; else more.hidden=true;
  }catch(e){
    setSearchStatus(`Error: ${e.message}`,'error');
    if(e.message.includes('code 21') || e.message.includes('IP')) showToast('FatSecret code 21: whitelistea la IP DEL SERVIDOR en FatSecret Dashboard','error');
    else showToast('Error de búsqueda FatSecret.','error');
    console.error(e);
  }
}

async function onSelectFood(food){
  selectedFood=food;
  $('#selected-food-panel').hidden=false;
  $('#selected-food-panel').style.display='';
  renderSelectedFood(food, $('#input-quantity').value);
  $('#input-quantity').focus();
  // Enriquecer con detalle FatSecret si el search solo trajo resumen
  if(food.foodId.startsWith('fatsecret-') && (!food.nutrientsPerServing || (food.nutrientsPerServing.calories===0 && food.nutrientsPerServing.protein===0))){
    try{
      setSearchStatus('Cargando detalle nutricional…','loading');
      const detail=await getFoodDetail(food.foodId);
      if(detail && detail.nutrientsPerServing.calories){
        selectedFood=detail;
        renderSelectedFood(detail, $('#input-quantity').value);
        setSearchStatus('Detalle cargado (FatSecret AR)','');
      }
    }catch(e){ console.warn('detalle fatsecret fallo',e); }
  } else if(food.foodId.startsWith('fatsecret-')){
    // intentar enriquecer silenciosamente para obtener fiber/sugar/sodium completos
    getFoodDetail(food.foodId).then(detail=>{
      if(detail && detail._servingId===food._servingId) {
        // si el detalle es más completo, actualizar
        if(detail.nutrientsPerServing.fiber || detail.nutrientsPerServing.sodium){
          selectedFood=detail;
          renderSelectedFood(detail, $('#input-quantity').value);
        }
      }
    }).catch(()=>{});
  }
}

function updatePreview(){
  if(!selectedFood) return;
  renderSelectedFood(selectedFood, $('#input-quantity').value);
}

function clearSelection(){
  selectedFood=null;
  $('#selected-food-panel').hidden=true;
}

function onAdd(e){
  e.preventDefault();
  if(!selectedFood){ showToast('Selecciona un alimento primero','error'); return; }
  const qty=Number($('#input-quantity').value);
  if(!Number.isFinite(qty) || qty<=0){ showToast('Cantidad debe ser mayor a 0','error'); return; }
  if(qty>100){ if(!confirm('Cantidad muy grande (>100). ¿Continuar?')) return; }
  const unit=$('#input-unit').value.trim() || 'porción';
  const time=$('#input-time').value || '';
  if(time && !/^\d{2}:\d{2}$/.test(time)){ showToast('Hora inválida','error'); return; }
  const entry=createEntryFromFood(selectedFood, qty, unit, time);
  addEntry(data, currentIso, entry);
  showToast(`Agregado: ${entry.name}`,'success');
  clearSelection();
  $('#search-input').value='';
  setSearchStatus('','');
  $('#search-results').innerHTML='';
  $('#search-pagination').hidden=true;
  refreshDay();
}

function onEditEntry(entry){
  // prompt simple para editar cantidad/unidad/hora (accesible y sin modal complejo)
  const newQty=prompt(`Editar cantidad para "${entry.name}" (actual: ${entry.quantity})`, String(entry.quantity));
  if(newQty===null) return;
  const q=Number(newQty);
  if(!Number.isFinite(q) || q<=0){ showToast('Cantidad inválida','error'); return; }
  const newUnit=prompt('Unidad:', entry.unit);
  if(newUnit===null) return;
  const newTime=prompt('Hora (HH:MM) o vacío:', entry.consumedAt||'');
  if(newTime===null) return;
  if(newTime && !/^\d{2}:\d{2}$/.test(newTime)){ showToast('Hora inválida','error'); return; }
  // recalcular
  const updated={ ...entry, quantity:q, unit:(newUnit.trim()||'porción'), consumedAt:newTime.trim() };
  // recalcular nutrientsTotal
  for(const k of Object.keys(entry.nutrientsPerServing)){
    updated.nutrientsTotal[k]= Math.round(entry.nutrientsPerServing[k]*q*100)/100;
  }
  // guardar
  try{
    // reemplazar
    const day=getDay(data, currentIso);
    const idx=day.entries.findIndex(x=>x.id===entry.id);
    if(idx>=0){ data.days[currentIso].entries[idx]=updated; saveData(data); }
    showToast('Registro actualizado','success');
    refreshDay();
  }catch(err){ showToast(err.message,'error'); }
}

function onDeleteEntry(entry){
  if(!confirm(`¿Eliminar "${entry.name}" del ${currentIso}?`)) return;
  try{
    removeEntry(data, currentIso, entry.id);
    showToast('Eliminado','success');
    refreshDay();
  }catch(err){ showToast(err.message,'error'); }
}

function onClearDay(){
  const day=getDay(data, currentIso);
  if(day.entries.length===0){ showToast('Día ya vacío',''); return; }
  if(!confirm(`¿Vaciar todos los registros del ${currentIso}? (${day.entries.length} alimentos)`)) return;
  clearDay(data, currentIso);
  showToast('Día vaciado','success');
  refreshDay();
}

function openDuplicate(){
  const day=getDay(data, currentIso);
  if(day.entries.length===0){ showToast('Nada que duplicar en este día','error'); return; }
  $('#dup-count').textContent=String(day.entries.length);
  $('#dup-source').textContent=currentIso;
  $('#dup-date').value=addDays(currentIso,1);
  $('#duplicate-dialog').showModal();
}
function onDuplicateSubmit(e){
  e.preventDefault();
  const target=$('#dup-date').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target)){ showToast('Fecha destino inválida','error'); return; }
  if(target===currentIso){ showToast('Elige una fecha distinta','error'); return; }
  try{
    const n=duplicateDay(data, currentIso, target);
    showToast(`Duplicados ${n} registros a ${target}`,'success');
    $('#duplicate-dialog').close();
    refreshHistory();
    if(confirm(`¿Ir a ${target}?`)){ currentIso=target; $('#date-picker').value=target; updateDateLabel(target); refreshDay(); }
  }catch(err){ showToast(err.message,'error'); }
}

async function onImport(){
  const file=$('#import-file').files[0];
  if(!file){ showToast('Selecciona un archivo JSON','error'); return; }
  const mode=document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
  if(mode==='replace' && !confirm('¿Reemplazar TODOS los datos actuales por el archivo? Esta acción no se puede deshacer.')){
    return;
  }
  try{
    const text=await file.text();
    // No ejecutar código: solo JSON.parse
    const parsed=JSON.parse(text);
    const summary=importData(data, parsed, mode);
    // recargar data por si replace
    const {data: reloaded}=loadData(); data=reloaded;
    refreshDay(); refreshHistory();
    const msg=`Importación (${mode}): ${summary.added} agregados, ${summary.skipped} omitidos, ${summary.daysImported} días.`;
    $('#import-result').textContent=msg;
    showToast(msg,'success');
  }catch(err){
    $('#import-result').textContent=`Error: ${err.message}`;
    showToast(`Error importación: ${err.message}`,'error');
  }
}

function onWipeAll(){
  if(!confirm('¿Borrar TODOS los datos de todos los días? Exporta antes si quieres conservarlos.')) return;
  if(!confirm('Confirmación final: se borrará todo el historial local. ¿Continuar?')) return;
  try{
    localStorage.removeItem('nutri-diary-data');
    const {data: fresh}=loadData(); data=fresh;
    refreshDay(); refreshHistory();
    showToast('Datos borrados','success');
    $('#data-dialog').close();
  }catch(err){ showToast(err.message,'error'); }
}

// iniciar
init();
