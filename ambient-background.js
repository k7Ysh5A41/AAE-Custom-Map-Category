"use strict";

// AAE ambient backdrop: layered copper/orange silk ribbons and traveling
// luminous motes, inspired by the motion language of console login screens.
// Pure Canvas 2D; no external assets, account data, pointer input, or timers.
(() => {
    const canvas = document.getElementById("ambientBackground");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", {alpha:true, desynchronized:true});
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 700px)");
    const palette = {
        orange:"255,105,52",
        ember:"246,78,43",
        amber:"255,185,112",
        pearl:"255,231,207"
    };
    const ribbons = [
        {y:.63,slope:-.16,arch:.075,wave:.052,width:.116,
         freq:1.22,speed:.095,phase:.2,ink:palette.orange,alpha:.95},
        {y:.78,slope:.11,arch:-.16,wave:.041,width:.089,
         freq:1.44,speed:-.082,phase:2.1,ink:palette.amber,alpha:.75},
        {y:.91,slope:-.11,arch:-.105,wave:.029,width:.062,
         freq:1.6,speed:.12,phase:4.1,ink:palette.ember,alpha:.66}
    ];

    let width=1;
    let height=1;
    let frame=0;
    let lastFrame=-Infinity;
    let startTime=null;
    let resizeObserver;
    let seed=3721608;
    const random=()=>{
        seed=(1664525*seed+1013904223)>>>0;
        return seed/4294967296;
    };
    const trailMotes=Array.from({length:53},(_,i)=>({
        ribbon:i%ribbons.length,
        start:random(),speed:.025+random()*.085,
        side:(random()-.5)*1.3,
        size:.95+random()*1.9,
        phase:random()*Math.PI*2,
        strength:.58+random()*.42
    }));
    const ambientMotes=Array.from({length:62},()=>({
        x:random(),y:random(),size:.45+random()*1.5,
        phase:random()*Math.PI*2,
        speed:.0018+random()*.006,
        alpha:.13+random()*.35,
        warm:random()>.36
    }));

    const rgba=(rgb,a)=>"rgba("+rgb+","+Math.max(0,Math.min(1,a))+")";

    function resize() {
        width=Math.max(1,window.innerWidth);
        height=Math.max(1,window.innerHeight);
        // Keep the full-screen buffer bounded on 4K/high-DPI displays.
        const scale=Math.max(.42,Math.min(window.devicePixelRatio||1,
            compact.matches?1.05:1.35,Math.sqrt(2400000/(width*height))));
        canvas.width=Math.max(1,Math.round(width*scale));
        canvas.height=Math.max(1,Math.round(height*scale));
        ctx.setTransform(scale,0,0,scale,0,0);
    }

    function radialLight(x,y,r,rgb,opacity) {
        const g=ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,rgba(rgb,opacity));
        g.addColorStop(.5,rgba(rgb,opacity*.24));
        g.addColorStop(1,rgba(rgb,0));
        ctx.fillStyle=g;
        ctx.fillRect(x-r,y-r,r*2,r*2);
    }

    function centerOf(r,u,t) {
        const envelope=Math.max(0,Math.sin(Math.PI*u));
        const phase=u*Math.PI*2*r.freq+t*r.speed+r.phase;
        const slowRoll=Math.sin(phase)*r.wave*(.36+.64*envelope);
        return {
            x:width*(u*1.46-.23)+Math.sin(t*.09+r.phase)*width*.016,
            y:height*(r.y+r.slope*(u-.5)+r.arch*envelope+slowRoll)
        };
    }

    function geometry(r,t,count) {
        const points=[];
        for(let i=0;i<=count;i++){
            const u=i/count;
            const center=centerOf(r,u,t);
            const prev=centerOf(r,Math.max(0,u-.002),t);
            const next=centerOf(r,Math.min(1,u+.002),t);
            const dx=next.x-prev.x,dy=next.y-prev.y;
            const len=Math.max(1,Math.hypot(dx,dy));
            const taper=Math.pow(Math.max(0,Math.sin(Math.PI*u)),.85);
            const fold=.68+.32*Math.pow(Math.sin(u*7.6+t*.32+r.phase),2);
            points.push({
                x:center.x,y:center.y,
                nx:-dy/len,ny:dx/len,
                halfWidth:height*r.width*taper*fold*.5,
                u
            });
        }
        return points;
    }

    function onRibbon(point,side) {
        return {
            x:point.x+point.nx*point.halfWidth*side,
            y:point.y+point.ny*point.halfWidth*side
        };
    }

    function strokeRibbonLine(points,side,rgb,alpha,lineWidth) {
        const grad=ctx.createLinearGradient(points[0].x,0,points[points.length-1].x,0);
        grad.addColorStop(0,rgba(rgb,0));
        grad.addColorStop(.16,rgba(rgb,alpha*.48));
        grad.addColorStop(.48,rgba(rgb,alpha));
        grad.addColorStop(.82,rgba(rgb,alpha*.62));
        grad.addColorStop(1,rgba(rgb,0));
        ctx.beginPath();
        for(let j=0;j<points.length;j++){
            const p=onRibbon(points[j],side);
            if(j===0)ctx.moveTo(p.x,p.y);
            else ctx.lineTo(p.x,p.y);
        }
        ctx.lineWidth=lineWidth;
        ctx.strokeStyle=grad;
        ctx.stroke();
    }

    function paintRibbon(r,t,small) {
        const segments=small?34:58;
        const points=geometry(r,t,segments);

        // Smooth translucent ribbon body. It tapers off-screen at both ends,
        // while the individual filaments provide a folded-silk appearance.
        ctx.beginPath();
        for(let i=0;i<points.length;i++){
            const p=onRibbon(points[i],1);
            if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        }
        for(let i=points.length-1;i>=0;i--){
            const p=onRibbon(points[i],-1);
            ctx.lineTo(p.x,p.y);
        }
        ctx.closePath();
        const fill=ctx.createLinearGradient(0,0,width,height);
        fill.addColorStop(0,rgba(palette.ember,0));
        fill.addColorStop(.28,rgba(r.ink,.042*r.alpha));
        fill.addColorStop(.56,rgba(r.ink,.102*r.alpha));
        fill.addColorStop(.85,rgba(palette.orange,.053*r.alpha));
        fill.addColorStop(1,rgba(palette.ember,0));
        ctx.fillStyle=fill;
        ctx.fill();

        // Broad luminous fold and fine fiber strands. Only their hue uses
        // the AAE controls' copper, ember, apricot, and warm-white palette.
        strokeRibbonLine(points,-.47,r.ink,.036*r.alpha,18);
        strokeRibbonLine(points,.25,palette.ember,.032*r.alpha,14);
        const strands=small?9:19;
        for(let i=0;i<strands;i++){
            const side=-.98+1.96*i/(strands-1);
            const crest=Math.pow(Math.max(0,1-Math.abs(side-.10)),2);
            const ink=i%5===0?palette.pearl:i%3===0?palette.amber:r.ink;
            const alpha=(.018+crest*.088)*r.alpha;
            strokeRibbonLine(points,side,ink,alpha,i%5===0?1.1:.65);
        }
        // The ribbon's sharp, gently illuminated folded edge.
        strokeRibbonLine(points,-.98,palette.amber,.11*r.alpha,1);
        strokeRibbonLine(points,.98,palette.ember,.075*r.alpha,1);
    }

    function paintMovingMotes(t,small) {
        const number=small?23:trailMotes.length;
        for(let i=0;i<number;i++){
            const m=trailMotes[i],r=ribbons[m.ribbon];
            const u=(m.start+t*m.speed)%1;
            const edge=Math.pow(Math.sin(Math.PI*u),1.15);
            if(edge<.045)continue;
            const location=centerOf(r,u,t);
            const next=centerOf(r,Math.min(1,u+.004),t);
            const dx=next.x-location.x,dy=next.y-location.y;
            const length=Math.max(1,Math.hypot(dx,dy));
            const normalX=-dy/length,normalY=dx/length;
            const half=height*r.width*.5*Math.pow(Math.sin(Math.PI*u),.85);
            const x=location.x+normalX*half*m.side;
            const y=location.y+normalY*half*m.side;
            if(x<0||x>width||y<0||y>height)continue;
            const blink=.74+.26*Math.sin(t*1.65+m.phase);
            const alpha=.64*m.strength*edge*blink;
            const tail=(10+m.size*12)*(small?.65:1);
            const head=ctx.createLinearGradient(
                x-dx/length*tail,y-dy/length*tail,x,y);
            head.addColorStop(0,rgba(palette.ember,0));
            head.addColorStop(.72,rgba(palette.orange,alpha*.16));
            head.addColorStop(1,rgba(palette.amber,alpha*.81));
            ctx.beginPath();
            ctx.moveTo(x-dx/length*tail,y-dy/length*tail);
            ctx.lineTo(x,y);
            ctx.strokeStyle=head;
            ctx.lineWidth=Math.max(.6,m.size*.58);
            ctx.stroke();
            if(i%3===0)radialLight(x,y,5+m.size*5,palette.orange,alpha*.20);
            ctx.beginPath();
            ctx.arc(x,y,.65+m.size*.63,0,Math.PI*2);
            ctx.fillStyle=rgba(i%4===0?palette.pearl:palette.amber,alpha);
            ctx.fill();
            if(i%5===0) {
                ctx.beginPath();
                ctx.arc(x,y,.6,0,Math.PI*2);
                ctx.fillStyle=rgba(palette.pearl,Math.min(1,alpha*1.18));
                ctx.fill();
            }
        }
    }

    function paintFloatingSparks(t,small) {
        const number=small?26:ambientMotes.length;
        for(let i=0;i<number;i++){
            const p=ambientMotes[i];
            // Slow diagonal drift, independent of the ribbons.
            const x=((p.x+t*p.speed)%1)*width;
            const y=((p.y-t*p.speed*.41+100)%1)*height;
            const visibility=.64+.36*Math.sin(t*.9+p.phase);
            const alpha=p.alpha*visibility*(y<height*.22?.37:1);
            const ink=p.warm?palette.amber:palette.pearl;
            if(i%9===0)radialLight(x,y,p.size*7,ink,alpha*.07);
            ctx.beginPath();
            ctx.arc(x,y,p.size,0,Math.PI*2);
            ctx.fillStyle=rgba(ink,alpha);
            ctx.fill();
        }
    }

    function paint(time) {
        ctx.clearRect(0,0,width,height);
        const motion=compact.matches?.55:1;
        const t=time*motion;
        radialLight(width*(.21+Math.sin(t*.14)*.035),height*.76,
            Math.max(width*.36,height*.38),palette.ember,.14);
        radialLight(width*(.80+Math.cos(t*.11)*.022),height*.58,
            Math.max(width*.34,height*.31),palette.orange,.102);
        radialLight(width*.57,height*.91,
            Math.max(width*.42,height*.32),palette.amber,.053);
        for(const ribbon of ribbons)paintRibbon(ribbon,t,compact.matches);
        paintMovingMotes(t,compact.matches);
        paintFloatingSparks(t,compact.matches);
    }

    function tick(timestamp) {
        frame=0;
        if(document.hidden||reducedMotion.matches)return;
        const frameGap=compact.matches?50:40; // 20/25 fps
        if(timestamp-lastFrame>=frameGap){
            lastFrame=timestamp;
            if(startTime===null)startTime=timestamp;
            paint((timestamp-startTime)/1000);
        }
        frame=requestAnimationFrame(tick);
    }

    function refresh() {
        if(frame)cancelAnimationFrame(frame);
        frame=0;
        lastFrame=-Infinity;
        resize();
        if(document.hidden)return;
        if(reducedMotion.matches)paint(0);
        else frame=requestAnimationFrame(tick);
    }

    window.addEventListener("resize",refresh,{passive:true});
    document.addEventListener("visibilitychange",refresh);
    if(typeof reducedMotion.addEventListener==="function")
        reducedMotion.addEventListener("change",refresh);
    else if(typeof reducedMotion.addListener==="function")
        reducedMotion.addListener(refresh);
    refresh();
})();
