import { readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
// Reviewed inbound HTML is data only. JSDOM never runs its scripts here.
const input = process.argv[2];
if (!input) throw new Error('Pass the restricted source directory explicitly');
const pageId='859c9cf0-657f-4585-a645-e93e66d940ca';
const formBlock='f04721a0-2430-4f24-8a24-202610240001';
for (const [source, output] of [['webinar-source.txt','landing.html'],['thanks-source.txt','thanks.html']]) {
 const vendor=await readFile(new URL('vendor/tilda-scripts-3.0.min.js',import.meta.url),'utf8');
 const doc=new JSDOM(await readFile(`${input}/${source}`,'utf8')).window.document;
 doc.documentElement.removeAttribute('foxified');doc.documentElement.removeAttribute('foxified-bridged');
 for(const script of doc.querySelectorAll('script')) {
  const src=script.getAttribute('src')||'',text=script.textContent||'';
  if(/sessionStorage|t270_init|addoncropExtensions|CRXEmulator/.test(text)){script.remove();continue;}
  if(src.includes('/tilda-scripts-3.0.min.js')){script.removeAttribute('src');script.textContent=vendor.replace('window.parent.isPagePreview','window.isPagePreview');continue;}
  if(text.includes('annexxAddStyle') && text.includes('localStorage'))script.textContent=text.replace('(function() {','(function() { var localStorage; try { localStorage=window.localStorage; } catch(e) { localStorage={getItem:function(){return null},setItem:function(){},removeItem:function(){}}; }');
  if(/chrome-extension:|mc\.yandex|connect\.facebook|tilda-stat|tilda-forms-1/.test(src)||/fbq\(|ym\(|tildastat|tildaStat|yaCounter/.test(text))script.remove();
 }
 for(const el of doc.querySelectorAll('noscript,iframe[src*="facebook"],iframe[src*="mc.yandex"],img[src*="facebook.com/tr"],img[src*="mc.yandex.ru/watch"]'))el.remove();
 for(const el of doc.querySelectorAll('[href],[src],[content]'))for(const attr of ['href','src','content']){
  const value=el.getAttribute(attr);if(value?.includes('https://aira.academy/gorbova-web-2410'))el.setAttribute(attr,value.replaceAll('https://aira.academy/gorbova-web-2410','https://gorbova.by/web-2410'));
  if(value?.includes('https://aira.academy/thx-gorbova-web-2410'))el.setAttribute(attr,value.replaceAll('https://aira.academy/thx-gorbova-web-2410','https://gorbova.by/thx-web-2410'));
 }
 if(output==='landing.html'){
  const form=doc.querySelector('#form4769688301');if(!form)throw Error('Source form changed');
  form.removeAttribute('action');form.removeAttribute('method');form.classList.remove('js-form-proccess');
  for(const attr of [...form.attributes])if(attr.name.startsWith('data-'))form.removeAttribute(attr.name);
  form.setAttribute('data-lovable-registration-form',formBlock);
  const first=form.querySelector('input[name="name"]');first.name='first_name';first.autocomplete='given-name';first.setAttribute('aria-label','Имя');first.required=true;
  const firstGroup=first.closest('.t-input-group');
  const lastGroup=firstGroup.cloneNode(true),last=lastGroup.querySelector('input');
  last.name='last_name';last.autocomplete='family-name';last.setAttribute('aria-label','Фамилия');last.value='';
  lastGroup.querySelector('.t-input__vis-ph').textContent='Ваша фамилия';
  lastGroup.setAttribute('data-field-name','last_name');lastGroup.removeAttribute('data-input-lid');
  const row=doc.createElement('div');row.className='gorbova-registration-names';firstGroup.before(row);row.append(firstGroup,lastGroup);
  form.querySelector('input[name="email"]').required=true;
  const style=doc.createElement('style');style.textContent='.gorbova-registration-names{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gorbova-registration-names .t-input-group{min-width:0}.gorbova-registration-names input{width:100%;box-sizing:border-box}.gorbova-registration-names .t-input__vis-ph{font-size:14px!important}';doc.head.append(style);
  const script=doc.createElement('script');script.textContent=`
  // The platform owns authentication, profile updates and submissions.
  window.addEventListener('submit',function(event){
    var form=event.target;if(!form.matches('[data-lovable-registration-form]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!form.reportValidity())return;
    var checkbox=form.querySelector('input[type="checkbox"]');
    if(checkbox&&!checkbox.checked){checkbox.required=true;checkbox.reportValidity();return;}
    var phone=form.querySelector('input[name="Phone"]'),visiblePhone=form.querySelector('input[type="tel"]');
    var phoneValue=(phone&&phone.value)||(visiblePhone&&visiblePhone.value)||'';
    if(phoneValue&&phoneValue[0]!=='+')phoneValue=((visiblePhone&&visiblePhone.getAttribute('data-phonemask-code'))||'+375')+phoneValue;
    parent.postMessage({type:'site-action',action:'open-registration',payload:{form_block_id:form.getAttribute('data-lovable-registration-form'),contacts:{first_name:form.querySelector('[name="first_name"]').value,last_name:form.querySelector('[name="last_name"]').value,email:form.querySelector('[name="email"]').value,phone:phoneValue}}},'*');
  },true);`;doc.head.prepend(script);
 } else {
  // The two destinations are intentionally supplied by reviewed CMS settings,
  // never guessed from another product/channel. Filled by the release builder.
  for(const atom of doc.querySelectorAll('.tn-atom,.t-btn')){
   if(/^(ПЕРЕЙТИ В ТЕЛЕГРАМ|ПРИСОЕДИНИТЬСЯ СЕЙЧАС)$/.test((atom.querySelector('.t-btnflex__text')?.textContent || atom.textContent).replace(/\s+/g,' ').trim()))atom.setAttribute('data-webinar-telegram-cta','true');
  }
 }
 await writeFile(new URL(output,import.meta.url),'<!doctype html>\n'+doc.documentElement.outerHTML+'\n');
}
console.log(JSON.stringify({pageId,formBlock,outputs:['landing.html','thanks.html']}));
