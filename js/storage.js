// storage.js — capa localStorage aislada, versionada y validada
export const STORAGE_KEY = "nutri-diary-data";
export const CURRENT_VERSION = 1;

function todayISO(){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
function genId(){
  return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
}
export function defaultData(){
  return { version: CURRENT_VERSION, days:{}, settings:{ unitSystem:'metric', theme:'light' } };
}

export function isStorageAvailable(){
  try{
    const k='__nutri_test__';
    localStorage.setItem(k,'1'); localStorage.removeItem(k);
    return true;
  }catch{ return false; }
}

export function loadData(){
  if(!isStorageAvailable()) return { data: defaultData(), error:'localStorage no disponible' };
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { data: defaultData(), error:null };
    const parsed = JSON.parse(raw);
    const normalized = normalizeData(parsed);
    // si migró, guardar
    if(normalized.version !== parsed.version) saveData(normalized);
    return { data: normalized, error:null };
  }catch(e){
    console.warn('loadData error',e);
    return { data: defaultData(), error:'Datos corruptos, se inició un almacenamiento limpio.' };
  }
}

export function saveData(data){
  if(!isStorageAvailable()) throw new Error('localStorage no disponible');
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }catch(e){
    if(e.name === 'QuotaExceededError' || e.code===22) throw new Error('Almacenamiento lleno. Exporta y borra días antiguos.');
    throw e;
  }
}

export function normalizeData(raw){
  const base = defaultData();
  if(!raw || typeof raw!=='object') return base;
  let version = Number(raw.version) || CURRENT_VERSION;
  // futura migración: if(version<1){...}
  const days = {};
  const srcDays = raw.days && typeof raw.days==='object' ? raw.days : {};
  for(const [date, day] of Object.entries(srcDays)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entries = Array.isArray(day.entries) ? day.entries.map(normalizeEntry).filter(Boolean) : [];
    days[date] = { date, entries };
  }
  const settings = {
    unitSystem: raw.settings?.unitSystem === 'imperial' ? 'imperial' : 'metric',
    theme: raw.settings?.theme === 'dark' ? 'dark' : (raw.settings?.theme === 'light' ? 'light' : base.settings.theme)
  };
  return { version: CURRENT_VERSION, days, settings };
}

function normalizeEntry(e){
  if(!e || typeof e!=='object') return null;
  const id = typeof e.id==='string' && e.id ? e.id : genId();
  const per = normalizeNutrients(e.nutrientsPerServing);
  const qty = Number(e.quantity); // validar
  const quantity = Number.isFinite(qty) && qty>0 ? qty : 1;
  // recalcular totales por si vienen inconsistentes
  const total = calcTotalFromPer(per, quantity, e.nutrientsTotal);
  return {
    id,
    foodId: String(e.foodId ?? e.id ?? ''),
    name: String(e.name ?? 'Alimento').slice(0,120),
    brand: e.brand ? String(e.brand).slice(0,120) : '',
    category: e.category ? String(e.category).slice(0,120) : '',
    quantity,
    unit: String(e.unit ?? 'porción').slice(0,30) || 'porción',
    servingSize: Number.isFinite(Number(e.servingSize)) ? Number(e.servingSize) : 100,
    servingUnit: String(e.servingUnit ?? 'g').slice(0,20) || 'g',
    consumedAt: /^\d{2}:\d{2}$/.test(e.consumedAt||'') ? e.consumedAt : '',
    nutrientsPerServing: per,
    nutrientsTotal: total
  };
}
function normalizeNutrients(n){
  const keys=['calories','protein','carbohydrates','fat','fiber','sugar','sodium'];
  const out={};
  for(const k of keys){
    const v = Number(n?.[k]);
    out[k]= Number.isFinite(v) && v>=0 ? Math.round(v*100)/100 : 0;
  }
  return out;
}
function calcTotalFromPer(per, qty, existing){
  const out={};
  for(const k of Object.keys(per)){
    out[k]= Math.round(per[k]*qty*100)/100;
  }
  return out;
}

// Helpers de alto nivel
export function getDay(data, isoDate){
  return data.days[isoDate] || { date: isoDate, entries: [] };
}
export function upsertEntry(data, isoDate, entry){
  if(!data.days[isoDate]) data.days[isoDate]={date:isoDate, entries:[]};
  const idx = data.days[isoDate].entries.findIndex(x=>x.id===entry.id);
  if(idx>=0) data.days[isoDate].entries[idx]=normalizeEntry(entry);
  else data.days[isoDate].entries.push(normalizeEntry(entry));
  saveData(data);
}
export function addEntry(data, isoDate, entry){
  if(!entry.id) entry.id=genId();
  upsertEntry(data, isoDate, entry);
  return entry.id;
}
export function removeEntry(data, isoDate, entryId){
  const day=data.days[isoDate]; if(!day) return;
  day.entries=day.entries.filter(e=>e.id!==entryId);
  if(day.entries.length===0) {/* mantener día vacío hasta limpiar historial opcional */}
  saveData(data);
}
export function clearDay(data, isoDate){
  if(data.days[isoDate]){ data.days[isoDate].entries=[]; saveData(data); }
}
export function duplicateDay(data, sourceIso, targetIso){
  const src=getDay(data, sourceIso);
  if(!src.entries.length) throw new Error('Día origen sin registros');
  if(!data.days[targetIso]) data.days[targetIso]={date:targetIso, entries:[]};
  const clones = src.entries.map(e=>({ ...structuredClone(e), id: genId() }));
  // evitar duplicados exactos por nombre+hora si ya existen
  const existingKeys = new Set(data.days[targetIso].entries.map(x=> x.name+'|'+x.consumedAt+'|'+x.quantity));
  const toAdd = clones.filter(c=> !existingKeys.has(c.name+'|'+c.consumedAt+'|'+c.quantity));
  data.days[targetIso].entries.push(...toAdd);
  saveData(data);
  return toAdd.length;
}
export function getHistoryDates(data){
  return Object.keys(data.days)
    .filter(d=> data.days[d].entries.length>0)
    .sort((a,b)=> b.localeCompare(a));
}
export function createEntryFromFood(food, quantity, unit, consumedAt){
  const per = food.nutrientsPerServing || {};
  const qty = Number(quantity);
  const totals={};
  for(const k of ['calories','protein','carbohydrates','fat','fiber','sugar','sodium']){
    totals[k]= Math.round((Number(per[k]||0)*qty)*100)/100;
  }
  return {
    id: genId(),
    foodId: String(food.foodId),
    name: food.name,
    brand: food.brand||'',
    category: food.category||'',
    quantity: qty,
    unit: unit||'porción',
    servingSize: food.servingSize||100,
    servingUnit: food.servingUnit||'g',
    consumedAt: consumedAt||'',
    nutrientsPerServing: per,
    nutrientsTotal: totals
  };
}
