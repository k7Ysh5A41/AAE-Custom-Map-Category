"use strict";
const DATA_URL="./custommap_cate.json";
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={categories:[],maps:[],selected:null,query:"",liteOnly:false};
function categoryName(c){
 const key=String(c.button||"");
 const m=/^AAEP_(.+?)_MAP$/i.exec(key);
 return m?m[1].replaceAll("_"," · "):(key||"分类 "+c.index);
}
function normalize(raw){
 if(!Array.isArray(raw))throw Error("JSON 顶层必须为数组");
 const maps=[];
 const categories=raw.map((c,i)=>{
  if(!c||!Array.isArray(c.ugc))throw Error("分类 "+(i+1)+" 缺少 ugc 数组");
  const category={...c,order:i,name:categoryName(c)};
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
  (!q||[m.id,m.category.name,m.category.index,m.category.button,m.category.description].some(v=>String(v??"").toLowerCase().includes(q)))
 );
}
function renderNav(){
 const buttons=[{order:null,name:"全部地图",ugc:state.maps},...state.categories];
 $("categoryNav").innerHTML=buttons.map(c=>'<button class="nav-btn'+(state.selected===c.order?' active':'')+'" data-category="'+(c.order??"all")+'"><span>'+escapeHtml(c.name)+'</span><small>'+c.ugc.length+'</small></button>').join("");
}
function render(){
 renderNav();
 const category=state.categories[state.selected];
 $("viewTitle").textContent=state.selected===null?"全部地图":(category?.name||"分类");
 const matches=filtered();
 $("resultCount").textContent=matches.length.toLocaleString("zh-CN")+" 条";
 if(state.selected===null&&!state.query&&!state.liteOnly){
  $("catalog").innerHTML=state.categories.map(c=>{
   const liteCount=c.ugc.filter(v=>v&&typeof v==="object"&&v.lite_only===true).length;
   return '<article tabindex="0" role="button" class="card category-card" data-open="'+c.order+'"><div class="card-head"><span class="chip">CATEGORY '+escapeHtml(c.index)+'</span><span class="meta">#'+(c.order+1)+'</span></div><h3>'+escapeHtml(c.name)+'</h3><p class="meta">'+escapeHtml(c.button??"")+'</p><div class="category-count">'+c.ugc.length+' <small>地图</small></div><span class="meta">'+(liteCount?liteCount+" 条 Lite 专属":"查看地图 →")+'</span></article>';
  }).join("");
  return;
 }
 $("catalog").innerHTML=matches.length?matches.map(m=>{
  const url="https://steamcommunity.com/sharedfiles/filedetails/?id="+encodeURIComponent(m.id);
  return '<article class="card"><div class="card-head"><span class="chip">分类 '+escapeHtml(m.category.index)+'</span>'+(m.liteOnly?'<span class="chip lite">LITE ONLY</span>':'')+'</div><h3>'+escapeHtml(m.id)+'</h3><div class="meta">'+escapeHtml(m.category.name)+' · 条目 '+m.position+'</div><div class="actions"><button data-copy="'+escapeHtml(m.id)+'">复制 ID</button><a target="_blank" rel="noopener noreferrer" href="'+url+'">Steam ↗</a></div></article>';
 }).join(""):'<p class="empty">没有匹配的地图条目。请调整分类或搜索条件。</p>';
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
  const c=e.target.closest("[data-copy]");if(c){await copy(c.dataset.copy);c.textContent="已复制";setTimeout(()=>c.textContent="复制 ID",1300);return;}
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
  const data=normalize(await response.json());
  state.categories=data.categories;state.maps=data.maps;
  $("groupCount").textContent=data.categories.length.toLocaleString("zh-CN");
  $("mapCount").textContent=data.maps.length.toLocaleString("zh-CN");
  $("liteCount").textContent=data.maps.filter(m=>m.liteOnly).length.toLocaleString("zh-CN");
  render();
 }catch(e){$("catalog").innerHTML="";$("errorMessage").hidden=false;$("errorMessage").textContent="无法读取 custommap_cate.json："+e.message;}
}
document.addEventListener("DOMContentLoaded",init);