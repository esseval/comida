// history.js — helpers de historial (se usa desde storage + ui)
import { getHistoryDates, getDay } from './storage.js';
import { sumDayEntries } from './nutrition.js';

export function buildHistoryModel(data){
  const dates = getHistoryDates(data);
  return dates.map(iso=>{
    const day=getDay(data, iso);
    const totals=sumDayEntries(day.entries);
    return { date: iso, count: day.entries.length, totals };
  });
}
export function formatDateLong(iso){
  try{
    const d=new Date(iso+'T12:00:00');
    return d.toLocaleDateString('es-ES', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  }catch{ return iso; }
}
export function isoToday(){
  const d=new Date();
  const off=d.getTimezoneOffset();
  d.setMinutes(d.getMinutes()-off);
  return d.toISOString().slice(0,10);
}
export function addDays(iso, delta){
  const d=new Date(iso+'T12:00:00');
  d.setDate(d.getDate()+delta);
  const off=d.getTimezoneOffset();
  d.setMinutes(d.getMinutes()-off);
  return d.toISOString().slice(0,10);
}
