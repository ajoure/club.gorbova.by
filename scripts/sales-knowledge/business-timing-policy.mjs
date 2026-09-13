// Executable reference for business-window tests; production enforces these windows
// atomically in sales_delivery_gate/sales_reminder_due (cb21-v2 migration).
const HOUR=3600000, MINUTE=60000;
const dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const ms=x=>typeof x==='number'?x:Date.parse(x);
function windowFor(t) {
 const p=Object.fromEntries(dateParts.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 const offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(t/1000)*1000;
 const midnight=Date.UTC(p.year,p.month-1,p.day)-offset;
 return {open:midnight+8*HOUR,close:midnight+23*HOUR};
}
const randomPart=r=>{if(!Number.isFinite(r)||r<0||r>=1)throw Error('invalid_random');return r;};
function inHours(t) {const w=windowFor(t);return t>=w.open&&t<w.close;}
function nextOpen(t) {const w=windowFor(t);return t<w.open?w.open:windowFor(t+24*HOUR).open;}
export function planReplyTime({now,lastInbound,continuation=false,eventState='unknown',random=.5}) {
 now=ms(now);lastInbound=ms(lastInbound);
 if(!Number.isFinite(now)||!Number.isFinite(lastInbound)||lastInbound>now)throw Error('invalid_timestamp');
 const deadline=lastInbound+24*HOUR-MINUTE;
 if(now>=deadline)return {action:'hold',reason:'telegram_window_expired'};
 if(eventState!=='clear')return {action:'hold',reason:eventState==='active'?'event_running':'event_state_unknown'};
 let due=now+(60+randomPart(random)*120)*1000;
 if(!continuation&&!inHours(due))due=nextOpen(due)+(60+randomPart(random)*120)*1000;
 if(due>=deadline)return {action:'hold',reason:'no_send_window'};
 return {action:'schedule',dueAt:new Date(due).toISOString(),deadline:new Date(deadline).toISOString()};
}
export function planReengagement({now,lastInbound,lastSeller,alreadyAttempted=false,awaitingAnswer=true,humanHold=false,eventState='unknown',random=.5}) {
 now=ms(now);lastInbound=ms(lastInbound);lastSeller=ms(lastSeller);
 if(![now,lastInbound,lastSeller].every(Number.isFinite)||lastInbound>lastSeller||lastSeller>now)throw Error('invalid_timestamp');
 if(alreadyAttempted||!awaitingAnswer||humanHold)return {action:'none',reason:'conversation_not_eligible'};
 if(eventState!=='clear')return {action:'none',reason:'event_not_clear'};
 const deadline=lastInbound+24*HOUR-15*MINUTE;
 const earliest=Math.max(now,lastInbound+8*HOUR,lastSeller+2*HOUR);
 if(earliest>=deadline)return {action:'none',reason:'no_safe_window'};
 const target=lastInbound+(16+randomPart(random)*4)*HOUR;
 const intervals=[];
 for(const t of [lastInbound,lastInbound+24*HOUR]) {
  const w=windowFor(t),a=Math.max(earliest,w.open),b=Math.min(deadline,w.close-MINUTE);
  if(a<=b)intervals.push([a,b]);
 }
 if(!intervals.length)return {action:'none',reason:'no_safe_window'};
 const next=intervals.filter(([,b])=>b>=target).map(([a])=>Math.max(a,target)).sort((a,b)=>a-b)[0];
 const due=next??Math.max(...intervals.map(([,b])=>b));
 return {action:'schedule',dueAt:new Date(due).toISOString(),deadline:new Date(deadline).toISOString(),maxAttempts:1};
}
