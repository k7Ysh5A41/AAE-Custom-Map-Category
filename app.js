"use strict";
const DATA_URL="./custommap_cate.json";
const LOCALIZATION_BASE="https://raw.githubusercontent.com/k7Ysh5A41/AAE-localizedstrings/main/english/localizedstrings/";
const LOCALIZATION_MIRROR="./localization/";
const translations=new Map();

// In a StringEd .str file, REFERENCE and LANG_ENGLISH form a pair.
// The filename supplies the namespace: AAEP.str + ZC2_MAP = AAEP_ZC2_MAP.
function parseStringEd(source,prefix){
 let reference=null;
 let count=0;
 for(const line of source.split(/\r?\n/)){
  const ref=line.match(/^\s*REFERENCE\s+([A-Za-z0-9_]+)/);
  if(ref){reference=ref[1];continue;}
  const value=line.match(/^\s*LANG_ENGLISH\s+"((?:\\.|[^"\\])*)"/);
  if(value&&reference){
   const text=value[1].replace(/\\([nrt"\\])/g,(_,c)=>c==="n"?"\n":c==="r"?"\r":c==="t"?"\t":c).replace(/\^[0-9]/g,"");
   translations.set(prefix+"_"+reference,text);
   count++;
  }
 }
 return count;
}
// Use the localization copy generated at Pages build time first.
// Fall back to reading the upstream repository directly. Neither translation
// values nor category-specific mappings are maintained in this repository.
async function loadStringEd(prefix){
 const sources=[
  LOCALIZATION_MIRROR+encodeURIComponent(prefix)+".str",
  LOCALIZATION_BASE+encodeURIComponent(prefix)+".str"
 ];
 const failures=[];
 for(const source of sources){
  try{
   const response=await fetch(source,{cache:"no-store"});
   if(!response.ok)throw Error("HTTP "+response.status);
   const content=await response.text();
   const matches=parseStringEd(content,prefix);
   if(!matches)throw Error("No English references in StringEd file");
   return;
  }catch(error){failures.push(error.message);}
 }
 throw Error(prefix+": "+failures.join("; "));
}
async function loadLocalizations(categories){
 translations.clear();
 const prefixes=[...new Set(categories.flatMap(category=>[category?.button,category?.description])
  .filter(key=>typeof key==="string")
  .map(key=>/^([A-Za-z0-9]+)_/.exec(key)?.[1])
  .filter(Boolean))];
 const results=await Promise.allSettled(prefixes.map(loadStringEd));
 return results.filter(item=>item.status==="rejected").map(item=>item.reason.message);
}
function localized(key){return translations.get(key);}
function categorySummary(category){return localized(category.description)||"";}
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={categories:[],maps:[],selected:null,query:"",liteOnly:false};
function categoryName(c){
 const key=String(c.button||"");
 const m=/^AAEP_(.+?)_MAP$/i.exec(key);
 return localized(key)||(m?m[1].replaceAll("_"," · "):(key||"Category "+c.index));
}
function normalize(raw){
 if(!Array.isArray(raw))throw Error("The JSON root must be an array");
 const maps=[];
 const categories=raw.map((c,i)=>{
  if(!c||!Array.isArray(c.ugc))throw Error("Category "+(i+1)+" has no ugc array");
  const category={...c,order:i,name:categoryName(c),summary:categorySummary(c)};
  c.ugc.forEach((v,pos)=>{
   const object=typeof v==="object"&&v!==null&&!Array.isArray(v);
   const id=String(object?(v.id??""):v);
   if(id)maps.push({id,liteOnly:object&&v.lite_only===true,category:category,position:pos+1});
  });
  return category;
 });
 return {categories,maps};
}
function filtered(){
 const q=state.query.trim().toLowerCase();
 return state.maps.filter(m=>
  (state.selected===null||m.category.order===state.selected)&&
  (!state.liteOnly||m.liteOnly)&&
  (!q||[m.id,m.category.name,m.category.summary,m.category.index,m.category.button,m.category.description].some(v=>String(v??"").toLowerCase().includes(q)))
 );
}
function renderNav(){
 const buttons=[{order:null,name:"All Maps",ugc:state.maps},...state.categories];
 $("categoryNav").innerHTML=buttons.map(c=>'<button class="nav-btn'+(state.selected===c.order?' active':'')+'" data-category="'+(c.order??"all")+'" title="'+escapeHtml(c.summary||"")+'"><span>'+escapeHtml(c.name)+'</span><small>'+c.ugc.length+'</small></button>').join("");
}
function render(){
 renderNav();
 const category=state.categories[state.selected];
 $("viewTitle").textContent=state.selected===null?"All Maps":(category?.name||"Category");
 $("viewDescription").textContent=state.selected===null?"":(category?.summary||"");
 const matches=filtered();
 $("resultCount").textContent=matches.length.toLocaleString("en-US")+" entries";
 if(state.selected===null&&!state.query&&!state.liteOnly){
  $("catalog").innerHTML=state.categories.map(c=>{
   const liteCount=c.ugc.filter(v=>v&&typeof v==="object"&&v.lite_only===true).length;
   return '<article tabindex="0" role="button" class="card category-card" data-open="'+c.order+'"><div class="card-head"><span class="chip">CATEGORY '+escapeHtml(c.index)+'</span><span class="meta">#'+(c.order+1)+'</span></div><h3>'+escapeHtml(c.name)+'</h3><p class="category-summary">'+escapeHtml(c.summary||"")+'</p><div class="category-count">'+c.ugc.length+' <small>maps</small></div><span class="meta">'+(liteCount?liteCount+" Lite-only entries":"Browse maps →")+'</span></article>';
  }).join("");
  return;
 }
 $("catalog").innerHTML=matches.length?matches.map(m=>{
  const url="https://steamcommunity.com/sharedfiles/filedetails/?id="+encodeURIComponent(m.id);
  return '<article class="card"><div class="card-head"><span class="chip">Category '+escapeHtml(m.category.index)+'</span>'+(m.liteOnly?'<span class="chip lite">LITE ONLY</span>':'')+'</div><h3>'+escapeHtml(m.id)+'</h3><div class="meta">'+escapeHtml(m.category.name)+' · Entry '+m.position+'</div><div class="actions"><button data-copy="'+escapeHtml(m.id)+'">Copy ID</button><a target="_blank" rel="noopener noreferrer" href="'+url+'">Steam ↗</a></div></article>';
 }).join(""):'<p class="empty">No matching maps. Try another category or search.</p>';
}
async function copy(value){
 try{await navigator.clipboard.writeText(value);}
 catch(e){
  const t=document.createElement("textarea");t.value=value;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();
 }
}
function csvEscape(v){return '"'+String(v??"").replaceAll('"','""')+'"';}
function exportCsv(){
 const rows=[["category_index","category_key","category_description","ugc_id","lite_only"],...filtered().map(m=>[m.category.index,m.category.button,m.category.description,m.id,m.liteOnly])];
 const csv="\ufeff"+rows.map(row=>row.map(csvEscape).join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="aae-custom-maps.csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bind(){
 $("categoryNav").addEventListener("click",e=>{
  const btn=e.target.closest("[data-category]");if(!btn)return;
  state.selected=btn.dataset.category==="all"?null:Number(btn.dataset.category);render();
 });
 $("catalog").addEventListener("click",async e=>{
  const c=e.target.closest("[data-copy]");if(c){await copy(c.dataset.copy);c.textContent="Copied";setTimeout(()=>c.textContent="Copy ID",1300);return;}
  const o=e.target.closest("[data-open]");if(o){state.selected=Number(o.dataset.open);render();window.scrollTo({top:310,behavior:"smooth"});}
 });
 $("catalog").addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-open]")){e.preventDefault();state.selected=Number(e.target.dataset.open);render();}
 });
 $("searchInput").addEventListener("input",e=>{state.query=e.target.value;render();});
 $("liteToggle").addEventListener("change",e=>{state.liteOnly=e.target.checked;render();});
 $("exportCsv").addEventListener("click",exportCsv);
}
async function init(){
 bind();
 try{
  const response=await fetch(DATA_URL,{cache:"no-store"});
  if(!response.ok)throw Error("HTTP "+response.status);
  const raw=await response.json();
  if(!Array.isArray(raw))throw Error("The JSON root must be an array");
  const localizationErrors=await loadLocalizations(raw);
  const data=normalize(raw);
  state.categories=data.categories;state.maps=data.maps;
  $("groupCount").textContent=data.categories.length.toLocaleString("en-US");
  $("mapCount").textContent=data.maps.length.toLocaleString("en-US");
  $("liteCount").textContent=data.maps.filter(m=>m.liteOnly).length.toLocaleString("en-US");
  render();
  if(localizationErrors.length){$("errorMessage").hidden=false;$("errorMessage").textContent="Localization unavailable: "+localizationErrors.join("; ");}else{$("errorMessage").hidden=true;}
 }catch(e){$("catalog").innerHTML="";$("errorMessage").hidden=false;$("errorMessage").textContent="Unable to load custommap_cate.json: "+e.message;}
}
document.addEventListener("DOMContentLoaded",init);