"use strict";

// Ambient particle river modeled after the user's PS5 login-screen reference,
// with AAE's warm accent colors. No PlayStation imagery or UI is embedded.
(() => {
    const canvas=document.getElementById("ambientBackground");
    if(!canvas)return;
    const ctx=canvas.getContext("2d",{alpha:true,desynchronized:true});
    if(!ctx)return;

    const motionPreference=window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact=window.matchMedia("(max-width: 700px)");
    // Source video 6s–25s: rose-grey atmosphere and ivory/gold particle stream.
    const COLORS=[
        [250,115,68], [205,144,121], [242,187,145],
        [255,235,208], [190,165,160]
    ];
    const FRAME_MS=1000/30;
    let width=1,height=1,backingScale=1;
    let raf=0,lastPaint=-Infinity,startedAt=null;
    let seed=0x6A7B6355;
    const rand=()=>{
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        return seed/4294967296;
    };
    const between=(a,b)=>a+(b-a)*rand();
    const normal=()=>{
        const x=Math.max(.00001,rand());
        return Math.max(-2.7,Math.min(2.7,
            Math.sqrt(-2*Math.log(x))*Math.cos(Math.PI*2*rand())));
    };

    function makeSprite(color,kind){
        const size=kind==="sharp"?56:kind==="blur"?104:124;
        const bitmap=document.createElement("canvas");
        bitmap.width=bitmap.height=size;
        const pen=bitmap.getContext("2d");
        if(!pen)return null;
        const c=color.join(",");
        const grad=pen.createRadialGradient(size/2,size/2,0,size/2,size/2,size*.49);
        if(kind==="sharp"){
            grad.addColorStop(0,"rgba("+c+",1)");
            grad.addColorStop(.14,"rgba("+c+",.96)");
            grad.addColorStop(.29,"rgba("+c+",.53)");
            grad.addColorStop(.56,"rgba("+c+",.09)");
            grad.addColorStop(1,"rgba("+c+",0)");
        }else if(kind==="blur"){
            grad.addColorStop(0,"rgba("+c+",.47)");
            grad.addColorStop(.25,"rgba("+c+",.34)");
            grad.addColorStop(.58,"rgba("+c+",.17)");
            grad.addColorStop(1,"rgba("+c+",0)");
        }else{
            grad.addColorStop(0,"rgba("+c+",.32)");
            grad.addColorStop(.3,"rgba("+c+",.25)");
            grad.addColorStop(.7,"rgba("+c+",.065)");
            grad.addColorStop(1,"rgba("+c+",0)");
        }
        pen.fillStyle=grad;
        pen.fillRect(0,0,size,size);
        return bitmap;
    }
    const sprites=COLORS.map(rgb=>({
        sharp:makeSprite(rgb,"sharp"),
        blur:makeSprite(rgb,"blur"),
        mist:makeSprite(rgb,"mist")
    }));

    // Reference shape: a broad S-shaped band emerges from the lower left,
    // climbs through the middle of the screen and drifts toward the right.
    // Fog and sparkles share this evolving trajectory, with gentle depth parallax.
    function streamY(u,time,lane){
        const swell=Math.exp(-Math.pow((u-.43)/.19,2));
        const dip=Math.exp(-Math.pow((u-.70)/.145,2));
        const slow=Math.sin(u*7.4-time*.16+lane*1.8)*.014;
        return .86-.39*u-.065*swell+.058*dip+slow+lane*.045;
    }

    // Seeded particles remain stable while scrolling, changing maps and
    // resizing the browser. Their motion is tied only to elapsed time.
    const streams=Array.from({length:710},(_,i)=>{
        const depth=rand();
        const bokeh=rand()<.15;
        const sharp=!bokeh && rand()<.56;
        return {
            u:rand(),
            initialY:rand(),
            lane:rand()<.36?-1:rand()<.52?0:1,
            scatter:normal()*(.032+depth*.036),
            drift:between(.007,.017)*(1+depth*.45),
            bob:between(.001,.009),.009),
            phase:between(0,Math.PI*2),
            blink:between(.17,.71),
            color:(()=>{const v=rand();return v<.035?0:v<.16?1:v<.49?2:v<.79?3:4;})(),
            kind:bokeh?"blur":sharp?"sharp":"mist",
            radius:bokeh?between(3.2,10.4):sharp?between(.58,1.80):between(1,3.5),
            alpha:bokeh?between(.12,.51):sharp?between(.25,.75):between(.055,.30)
        };
    });
    const floaters=Array.from({length:150},()=>({
        x:rand(),y:rand(),depth:rand(),
        drift:between(.0004,.0022),
        color:rand()<.55?3:2,
        radius:between(.5,1.45),
        alpha:between(.025,.22),
        phase:between(0,Math.PI*2)
    }));

    function resize(){
        width=Math.max(1,window.innerWidth);
        height=Math.max(1,window.innerHeight);
        const budget=compact.matches?1050000:2100000;
        backingScale=Math.max(.36,Math.min(window.devicePixelRatio||1,
            compact.matches?1.05:1.35,Math.sqrt(budget/(width*height))));
        canvas.width=Math.max(1,Math.round(width*backingScale));
        canvas.height=Math.max(1,Math.round(height*backingScale));
        ctx.setTransform(backingScale,0,0,backingScale,0,0);
    }

    function rgba(color,alpha){
        return "rgba("+color.join(",")+","+alpha+")";
    }
    function ellipticalGlow(x,y,radiusX,radiusY,rgb,alpha){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(radiusX,radiusY);
        const grad=ctx.createRadialGradient(0,0,0,0,0,1);
        grad.addColorStop(0,rgba(rgb,alpha));
        grad.addColorStop(.35,rgba(rgb,alpha*.47));
        grad.addColorStop(.78,rgba(rgb,alpha*.095));
        grad.addColorStop(1,rgba(rgb,0));
        ctx.fillStyle=grad;
        ctx.fillRect(-1,-1,2,2);
        ctx.restore();
    }

    function paintSpotlight(time){
        // A gentle cone entering from the ceiling at the reference's sixth second.
        const intro=Math.min(1,Math.max(0,time/2.8));
        const x=width*(.225-.105*intro+Math.sin(time*.052)*.009);
        ellipticalGlow(x,-height*.18,width*.56,height*.90,[237,215,208],.13+.15*intro);
        ellipticalGlow(x-width*.06,-height*.06,width*.34,height*.77,
            [219,190,190],.055+.06*intro);
        ellipticalGlow(x+width*.08,height*.24,width*.35,height*.68,
            [194,177,177],.024+.021*intro);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x-width*.135,-height*.16);
        ctx.lineTo(x+width*.19,-height*.16);
        ctx.lineTo(x+width*.405,height*.81);
        ctx.lineTo(x-width*.315,height*.82);
        ctx.closePath();
        const shaft=ctx.createLinearGradient(x,-height*.1,x+width*.08,height*.84);
        shaft.addColorStop(0,"rgba(239,214,203,"+(.067*intro)+")");
        shaft.addColorStop(.22,"rgba(227,203,198,"+(.040*intro)+")");
        shaft.addColorStop(.62,"rgba(204,182,184,"+(.011*intro)+")");
        shaft.addColorStop(1,"rgba(192,179,185,0)");
        ctx.fillStyle=shaft;
        ctx.fill();
        ctx.restore();
    }

    function paintMist(time){
        const reveal=Math.min(1,.35+time/7);
        const move=Math.sin(time*.12)*width*.025;
        ellipticalGlow(width*.14+move,height*.84,width*.48,height*.25,
            [169,166,175],.11*reveal);
        ellipticalGlow(width*.36-move*.5,height*.91,width*.48,height*.21,
            [139,135,151],.064*reveal);
        ellipticalGlow(width*.68+move*.24,height*.71,width*.46,height*.24,
            [128,115,130],.017*reveal);
        // No hard-edged silk bands: seven translucent clouds trace the curve.
        for(let i=0;i<7;i++){
            const u=(i+.35)/7;
            const px=width*(u*1.28-.12);
            const py=height*(streamY(u,time*.32,0)+.045);
            ellipticalGlow(px,py,width*.145,height*.085,
                [176,151,155],(.013+.005*Math.sin(time*.17+i))*reveal);
        }
    }

    function pointSprite(x,y,radius,alpha,color,kind){
        if(alpha<=.008)return;
        const sprite=sprites[color][kind];
        if(!sprite)return;
        const diameter=radius*(kind==="sharp"?4.8:kind==="blur"?4.2:4.9);
        ctx.globalAlpha=Math.min(1,alpha);
        ctx.drawImage(sprite,x-diameter/2,y-diameter/2,diameter,diameter);
    }

    function paintRiver(time){
        const count=compact.matches?275:streams.length;
        for(let i=0;i<count;i++){
            const p=streams[i];
            // Positive drift across the river; particles recycle beyond view.
            const u=(p.u+time*p.drift)%1;
            const x=width*(u*1.29-.145);
            const formed=Math.max(0,Math.min(1,(time-.2)/5));
            const ease=formed*formed*(3-2*formed);
            const waveY=streamY(u,time,p.lane)+p.scatter+
                Math.sin(time*.27+p.phase)*p.bob;
            const y=height*(p.initialY*(1-ease)+waveY*ease);
            if(x<-18||x>width+18||y<-18||y>height+18)continue;
            const edge=Math.pow(Math.max(0,Math.sin(Math.PI*u)),.42);
            const glint=Math.pow(Math.max(0,Math.sin(time*(.28+p.blink)+p.phase)),9);
            const twinkle=.57+.31*Math.sin(time*(.26+p.blink)+p.phase)+.30*glint;
            const alpha=p.alpha*(.55+.45*ease)*edge*Math.max(.17,twinkle);
            pointSprite(x,y,p.radius,alpha,p.color,p.kind);
            // Occasional tiny sharp centers on the brightest defocused motes.
            if(p.kind==="blur" && i%7===0)
                pointSprite(x,y,1.0,alpha*.49,3,"sharp");
        }
        ctx.globalAlpha=1;
    }

    function paintSparseDust(time){
        const count=compact.matches?55:floaters.length;
        for(let i=0;i<count;i++){
            const p=floaters[i];
            const x=width*((p.x+time*p.drift)%1);
            const y=height*(p.y+.006*Math.sin(time*.3+p.phase));
            const alpha=p.alpha*(.65+.35*Math.sin(time*.54+p.phase));
            pointSprite(x,y,p.radius,alpha,p.color,"sharp");
        }
        ctx.globalAlpha=1;
    }

    function paint(time){
        ctx.clearRect(0,0,width,height);
        paintSpotlight(time);
        paintMist(time);
        paintSparseDust(time);
        paintRiver(time);
    }

    function tick(timestamp){
        raf=0;
        if(document.hidden||motionPreference.matches)return;
        const interval=compact.matches?1000/24:FRAME_MS;
        if(timestamp-lastPaint>=interval){
            lastPaint=timestamp;
            if(startedAt===null)startedAt=timestamp;
            paint((timestamp-startedAt)/1000);
        }
        raf=requestAnimationFrame(tick);
    }

    function refresh(){
        if(raf)cancelAnimationFrame(raf);
        raf=0;
        lastPaint=-Infinity;
        resize();
        if(document.hidden)return;
        if(motionPreference.matches)paint(12); // still PS5-like composition
        else raf=requestAnimationFrame(tick);
    }

    window.addEventListener("resize",refresh,{passive:true});
    document.addEventListener("visibilitychange",refresh);
    if(motionPreference.addEventListener)
        motionPreference.addEventListener("change",refresh);
    else if(motionPreference.addListener)
        motionPreference.addListener(refresh);
    refresh();
})();
