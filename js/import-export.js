// import-export.js
import { normalizeData, CURRENT_VERSION, STORAGE_KEY } from './storage.js';

export function exportJSON(data){
  const payload={
    version: data.version || CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    days: data.days,
    settings: data.settings
  };
  const blob=new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const date=new Date().toISOString().slice(0,10);
  triggerDownload(blob, `registro-nutricional-${date}.json`);
}

export function exportCSV(data){
  const rows=[];
  // encabezado requerido
  rows.push(['Fecha','Hora','Alimento','Marca','Cantidad','Unidad','Calorías','Proteínas','Carbohidratos','Grasas','Fibra','Azúcares','Sodio']);
  const dates=Object.keys(data.days).sort();
  for(const iso of dates){
    for(const e of data.days[iso].entries){
      const t=e.nutrientsTotal||{};
      rows.push([
        iso, e.consumedAt||'', csvEscape(e.name), csvEscape(e.brand||''),
        e.quantity, csvEscape(e.unit||''),
        t.calories??0, t.protein??0, t.carbohydrates??0, t.fat??0, t.fiber??0, t.sugar??0, t.sodium??0
      ]);
    }
  }
  const csv=rows.map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob([csv], {type:'text/csv;charset=utf-8'});
  const date=new Date().toISOString().slice(0,10);
  triggerDownload(blob, `registro-nutricional-${date}.csv`);
}
function csvEscape(s){ return String(s).replace(/"/g,'""'); }
function triggerDownload(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// Validación de importación
export function validateImportFile(parsed){
  if(!parsed || typeof parsed!=='object') throw new Error('JSON no es un objeto');
  if(!parsed.days || typeof parsed.days!=='object') throw new Error('Falta "days" en el archivo');
  if(!parsed.version) throw new Error('Falta "version"');
  if(Number(parsed.version)!==CURRENT_VERSION){
    // permitir v1 únicamente por ahora, advertir si distinta
    throw new Error(`Versión no compatible: archivo v${parsed.version}, app v${CURRENT_VERSION}.`);
  }
  // validar estructura básica
  for(const [iso, day] of Object.entries(parsed.days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Fecha inválida: ${iso}`);
    if(!Array.isArray(day.entries)) throw new Error(`Entradas no son array en ${iso}`);
  }
  return true;
}

export function importData(currentData, importedRaw, mode='merge'){
  // mode: 'replace' | 'merge'
  validateImportFile(importedRaw);
  const imported = normalizeData(importedRaw);
  if(mode==='replace'){
    // reemplazar completamente (mantener version)
    const next = normalizeData(imported);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { daysImported: Object.keys(next.days).length, added: countEntries(next), skipped:0, errors:[], mode };
  } else {
    // merge: evitar duplicados por id
    let added=0, skipped=0, errors=[];
    const errorsList=[];
    for(const [iso, day] of Object.entries(imported.days)){
      if(!currentData.days[iso]) currentData.days[iso]={date:iso, entries:[]};
      const existingIds=new Set(currentData.days[iso].entries.map(e=>e.id));
      for(const e of day.entries){
        if(existingIds.has(e.id)){
          skipped++;
        } else {
          // también evitar duplicado por contenido idéntico si id distinto?
          currentData.days[iso].entries.push(e);
          added++;
        }
      }
    }
    // normalizar y guardar
    const normalized=normalizeData(currentData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    Object.assign(currentData, normalized);
    return { daysImported: Object.keys(imported.days).length, added, skipped, errors: errorsList, mode };
  }
}
function countEntries(d){
  let c=0; for(const k of Object.keys(d.days)) c+= d.days[k].entries.length; return c;
}
