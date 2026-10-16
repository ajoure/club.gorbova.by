import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {describe,it,expect,vi} from "vitest";
const html=readFileSync("scripts/webinars/web-2410/landing.html","utf8");
function fixture(){
 const dom=new JSDOM(html,{runScripts:"outside-only",url:"https://example.invalid/"});
 const window=dom.window;
 const script=[...window.document.scripts].find(s=>s.textContent?.includes("The platform owns authentication"));
 expect(script).toBeTruthy();
 window.eval(script!.textContent!); // Only our adapter, never the inbound vendor scripts.
 const post=vi.fn();window.postMessage=post;
 const form=window.document.querySelector<HTMLFormElement>("form[data-lovable-registration-form]")!;
 for(const [selector,value] of [["[name=first_name]","Тест"],["[name=last_name]","Владельца"],["[name=email]","owner@example.invalid"],["input[type=tel]","291234567"]])form.querySelector<HTMLInputElement>(selector)!.value=value;
 return {dom,window,form,post};
}
describe("Nikita registration form adapter",()=>{
 it("preserves all registration anchors and separates names without the Tilda endpoint",()=>{
  const {dom,window,form}=fixture();try{
   expect(window.document.querySelectorAll('a[href="#reg"]').length).toBe(4);
   expect(form.hasAttribute("action")).toBe(false);
   expect(form.querySelector('[name=first_name]')).toHaveAttribute("autocomplete","given-name");
   expect(form.querySelector('[name=last_name]')).toHaveAttribute("autocomplete","family-name");
   expect(html).not.toContain("chrome-extension://");
   expect(html).not.toContain("forms.tildacdn.com/procces");
  }finally{dom.window.close()}
 });
 it("passes bounded contacts through the platform bridge only after the checked consent",()=>{
  const {dom,window,form,post}=fixture();try{
   form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));expect(post).not.toHaveBeenCalled();
   form.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked=true;
   form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
   expect(post).toHaveBeenCalledOnce();expect(post.mock.calls[0][0]).toMatchObject({type:"site-action",action:"open-registration",payload:{contacts:{first_name:"Тест",last_name:"Владельца",email:"owner@example.invalid",phone:"+375291234567"}}});
  }finally{dom.window.close()}
 });
});
