// api.js — Cliente 100% Apache/Laragon (proxy.php + config.php server-side)
// Sin EXTERNAL_PROXIES, sin secrets en el browser. Todo FatSecret pasa por proxy.php.

const PROXY = 'proxy.php';

export function debounce(fn, delay=400){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
}

// Compat (ya no usados, se mantienen por si app.js antiguo los importa)
export function getFatSecretCreds(){ return {id:'',secret:''}; }
export function setFatSecretCreds(){}
export function getApiKey(){ return ''; }
export function setApiKey(){}
export function getProxyUrl(){ return ''; }
export function setProxyUrl(){}
export function getManualToken(){ return ''; }
export function setManualToken(){}
export function clearManualToken(){}
export function hasCreds(){ return true; }

async function fetchProxy(action, params){
  const usp = new URLSearchParams({action, ...params});
  // para search/food el backend espera POST, pero también acepta GET — usamos GET para simplicidad
  const url = `${PROXY}?${usp.toString()}`;
  const res = await fetch(url);
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    // Mensajes amigables
    if(txt.includes('config.php')) throw new Error('Falta config.php en el servidor. Copia config.php.example a config.php y completa tus credenciales FatSecret.');
    if(txt.includes('code') && txt.includes('21')){
      const m = txt.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      const ip = m ? m[1] : 'tu IP pública';
      throw new Error(`FatSecret code 21 — IP no whitelisteada (${ip}). Ve a platform.fatsecret.com → Manage Keys → IP Ranges y agrega ${ip}/32 (averigua tu IP en https://ifconfig.me). ` + txt.slice(0,300));
    }
    throw new Error(`proxy.php ${res.status}: ${txt.slice(0,400)}`);
  }
  return res.json();
}

export async function searchFoods(query, {page=1, pageSize=10}={}){
  const q=(query||'').trim();
  if(!q) return {foods:[], totalHits:0, source:'none'};
  const data = await fetchProxy('search', {q, page:String(page), pageSize:String(pageSize)});
  // proxy.php reenvía tal cual FatSecret: {foods:{food:[], total_results}} o {foods:{total_results:0}} si vacío
  if(data.foods){
    if(data.foods.food){
      const raw = data.foods.food; const arr = Array.isArray(raw) ? raw : [raw];
      const toTitle = s=> String(s).toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()).slice(0,120);
      const foods = arr.map(e=>{
        const fid=String(e.food_id||''); const desc=e.food_description||'';
        const get=(re)=>{ const m=desc.match(re); return m?Number(m[1]):0; };
        const per={calories:get(/Calories:\s*([\d.]+)kcal/i), fat:get(/Fat:\s*([\d.]+)g/i), carbohydrates:get(/Carbs:\s*([\d.]+)g/i), protein:get(/Protein:\s*([\d.]+)g/i), fiber:0, sugar:0, sodium:0};
        return { foodId:`fatsecret-${fid}`, name: toTitle(e.food_name||'Alimento'), brand: e.brand_name||'', category:e.food_type||'', servingSize:100, servingUnit:'g', nutrientsPerServing:per, _raw:e };
      });
      return {foods, totalHits: Number(data.foods.total_results||foods.length), source:'fatsecret'};
    }
    // Sin food (sin resultados o error estructurado) -> vacío seguro
    if(Array.isArray(data.foods)) return {foods: data.foods, totalHits: Number(data.totalHits||data.foods.length), source:'fatsecret'};
    const total = Number(data.foods.total_results ?? data.total_results ?? 0);
    return {foods:[], totalHits: total, source:'fatsecret'};
  }
  if(Array.isArray(data.foods)) return {foods: data.foods, totalHits: Number(data.totalHits||0), source:'fatsecret'};
  // Fallback defensivo: si viene {foods, totalHits} ya normalizado o error inesperado, nunca retornar undefined foods
  if(Array.isArray(data.foods)) return data;
  if(data && Array.isArray(data.foods)) return data;
  // Si es error no lanzado (raro), retornar vacío para que app.js no haga .length sobre undefined
  if(data && typeof data === 'object' && !data.foods) return {foods:[], totalHits:0, source:'fatsecret', _raw:data};
  return {foods:[], totalHits:0, source:'fatsecret'};
}

export async function getFoodDetail(foodId){
  if(!foodId || !foodId.startsWith('fatsecret-')) return null;
  try{
    const data = await fetchProxy('food', {id: foodId});
    // proxy.php devuelve food directo con servings
    if(data.food){
      const f=data.food; const toTitle=s=> String(s).toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()).slice(0,120);
      const servings=f.servings?.serving; let sObj=null;
      if(Array.isArray(servings)) sObj=servings.find(s=> s.is_default==1)||servings[0];
      else if(servings?.serving_id) sObj=servings;
      const parseServ=s=>{ const a=Number(s.metric_serving_amount), u=s.metric_serving_unit; if(Number.isFinite(a)&&u) return {size:a,unit:u}; const m=(s.serving_description||'').match(/([\d.,]+)\s*(g|ml|oz)/i); if(m) return {size:Number(m[1].replace(',','.'))||100, unit:m[2].toLowerCase()}; return {size:100,unit:'g'}; };
      let per={calories:0,protein:0,carbohydrates:0,fat:0,fiber:0,sugar:0,sodium:0}; let sz=100, su='g';
      if(sObj){ per={calories:Number(sObj.calories)||0, protein:Number(sObj.protein)||0, carbohydrates:Number(sObj.carbohydrate)||0, fat:Number(sObj.fat)||0, fiber:Number(sObj.fiber)||0, sugar:Number(sObj.sugar)||0, sodium:Number(sObj.sodium)||0}; const p=parseServ(sObj); sz=p.size; su=p.unit; }
      return { foodId, name: toTitle(f.food_name||'Alimento'), brand:f.brand_name||'', category:f.food_type||'', servingSize:sz, servingUnit:su, nutrientsPerServing:per, _servingId:sObj?.serving_id||null, _raw:f };
    }
    // fallback: si data ya es el mapeado
    return data;
  }catch{ return null; }
}
