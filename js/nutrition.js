// nutrition.js — cálculos nutricionales puros
export function calcTotals(perServing, quantity){
  const q = Number(quantity) || 0;
  const out = {};
  for(const k of ['calories','protein','carbohydrates','fat','fiber','sugar','sodium']){
    const v = Number(perServing?.[k] ?? 0);
    out[k] = round(v * q, 2);
  }
  return out;
}
export function round(n, decimals=2){
  const p = Math.pow(10, decimals);
  return Math.round(n * p)/p;
}
export function sumDayEntries(entries){
  const totals = {calories:0, protein:0, carbohydrates:0, fat:0, fiber:0, sugar:0, sodium:0};
  for(const e of entries){
    for(const k of Object.keys(totals)){
      totals[k] += Number(e.nutrientsTotal?.[k] ?? 0);
    }
  }
  for(const k of Object.keys(totals)) totals[k]=round(totals[k],2);
  return totals;
}
export function formatNutrient(key, value){
  const units ={calories:'kcal', protein:'g', carbohydrates:'g', fat:'g', fiber:'g', sugar:'g', sodium:'mg'};
  return `${value} ${units[key]||''}`.trim();
}
export const NUTRIENT_LABELS={
  calories:'Calorías', protein:'Proteínas', carbohydrates:'Carbohidratos', fat:'Grasas', fiber:'Fibra', sugar:'Azúcares', sodium:'Sodio'
};
