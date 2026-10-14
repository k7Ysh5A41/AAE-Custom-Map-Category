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
    // Match AAE's orange controls: dark warm space, gold bokeh, ivory flashes.
    const COLORS=[
        [250,86,48], [255,137,75], [255,187,117],
        [255,250,229], [214,150,110]
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
            grad.addColorStop(0,"rgba("+c+",.90)");
            grad.addColorStop(.25,"rgba("+c+",.62)");
            grad.addColorStop(.58,"rgba("+c+",.18)");
            grad.addColorStop(1,"rgba("+c+",0)");
        }else{
            grad.addColorStop(0,"rgba("+c+",.53)");
            grad.addColorStop(.3,"rgba("+c+",.36)");
            grad.addColorStop(.7,"rgba("+c+",.085)");
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
    const streams=Array.from({length:900},(_,i)=>{
        const depth=rand();
        const bokeh=rand()<.19;
        const sharp=!bokeh && rand()<.63;
        return {
            u:rand(),
            initialY:rand(),
            lane:rand()<.36?-1:rand()<.52?0:1,
            scatter:normal()*(.026+depth*.039),
            drift:between(.008,.019)*(1+depth*.45),
            bob:between(.001,.009),
            phase:between(0,Math.PI*2),
            blink:between(.17,.71),
            sparkle:rand()<.50,
            sparkleRate:between(.55,1.42),
            sparklePhase:between(0,Math.PI*2),
            color:(()=>{const v=rand();return v<.16?0:v<.39?1:v<.66?2:v<.92?3:4;})(),
            kind:bokeh?"blur":sharp?"sharp":"mist",
            radius:bokeh?between(3.6,12.2):sharp?between(.8,2.3):between(1.5,4.8),
            alpha:bokeh?between(.33,.76):sharp?between(.40,.80):between(.12,.36)
        };
    });
    const floaters=Array.from({length:185},()=>({
        x:rand(),y:rand(),depth:rand(),
        drift:between(.0004,.0022),
        color:rand()<.55?3:2,
        radius:between(.65,1.75),
        alpha:between(.06,.36),
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

    // One continuous volumetric field: filaments and soft shadows are
    // calculated inside the same alpha texture, never as stacked bands.
    function makeGodRayTexture(){
        const w=compact.matches?640:1024;
        const h=compact.matches?352:512;
        const bitmap=document.createElement("canvas");
        bitmap.width=w;
        bitmap.height=h;
        const brush=bitmap.getContext("2d");
        if(!brush)return null;
        const pixels=brush.createImageData(w,h);
        const data=pixels.data;
        for(let x=0;x<w;x++){
            const t=x/(w-1);
            // Open up the fan much farther than the previous narrow cone.
            const spread=.024+.96*Math.pow(t,.81);
            const entrance=1-Math.exp(-t*33);
            const fade=entrance*Math.exp(-t*.33);
            for(let y=0;y<h;y++){
                const cross=((y+.5)/h*2-1)/spread;
                const feather=Math.exp(-2.65*Math.pow(Math.abs(cross),1.65));
                // Low-contrast, continuous fine rays; no independent light layers.
                const detail=1
                    +.080*Math.sin(cross*22.7+t*2.1+.3*Math.sin(t*6.5))
                    +.047*Math.sin(cross*49.2-t*1.6)
                    +.026*Math.sin(cross*91.0+t*4.8)
                    +.10*Math.exp(-Math.pow((cross+.34-.022*Math.sin(t*4.4))/.054,2))
                    +.12*Math.exp(-Math.pow((cross-.10+.017*Math.sin(t*3.2))/.041,2))
                    +.08*Math.exp(-Math.pow((cross-.56)/.063,2));
                const k=(y*w+x)*4;
                data[k]=255;
                data[k+1]=210;
                data[k+2]=163;
                data[k+3]=Math.max(0,Math.min(255,
                    Math.round(237*fade*feather*detail)));
            }
        }
        brush.putImageData(pixels,0,0);
        return bitmap;
    }
    const godRayTexture=makeGodRayTexture();
    function paintGodRays(time,originX,originY){
        if(!godRayTexture)return;
        // Overshoot the viewport so the far edge never reveals a texture seam.
        const angle=.89+.008*Math.sin(time*.063);
        const length=Math.max(height*2.35,width*1.75);
        const halfHeight=Math.max(width*.66,height*.56);
        ctx.save();
        ctx.globalCompositeOperation="screen";
        ctx.translate(originX,originY);
        ctx.rotate(angle);
        ctx.globalAlpha=.88+.06*Math.sin(time*.13);
        ctx.drawImage(godRayTexture,0,-halfHeight,length,halfHeight*2);
        ctx.restore();
    }

    function paintSpotlight(time){
        const intro=Math.min(1,Math.max(0,time/2.2));
        const x=width*(.10+Math.sin(time*.052)*.003);
        const y=-height*.13;
        // A single wide atmosphere and a tightly blended source highlight.
        ellipticalGlow(x+width*.10,y+height*.11,
            width*.72,height*.79,[255,153,98],.18+.06*intro);
        paintGodRays(time,x,y);
        ellipticalGlow(x,-height*.045,width*.17,height*.23,
            [255,221,174],.27);
    }

    function paintMist(time){
        const reveal=Math.min(1,.35+time/7);
        const move=Math.sin(time*.12)*width*.025;
        ellipticalGlow(width*.14+move,height*.84,width*.48,height*.25,
            [180,141,115],.24*reveal);
        ellipticalGlow(width*.36-move*.5,height*.91,width*.48,height*.21,
            [123,105,98],.16*reveal);
        ellipticalGlow(width*.68+move*.24,height*.71,width*.46,height*.24,
            [114,89,76],.055*reveal);
        // No hard-edged silk bands: seven translucent clouds trace the curve.
        for(let i=0;i<7;i++){
            const u=(i+.35)/7;
            const px=width*(u*1.28-.12);
            const py=height*(streamY(u,time*.32,0)+.045);
            ellipticalGlow(px,py,width*.145,height*.085,
                [185,133,108],(.032+.012*Math.sin(time*.17+i))*reveal);
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
        const count=compact.matches?335:streams.length;
        ctx.save();
        ctx.globalCompositeOperation="lighter";
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
            const edge=.38+.62*Math.pow(Math.max(0,Math.sin(Math.PI*u)),.43);
            const simmer=.43+.17*Math.sin(time*(.36+p.blink)+p.phase);
            // Very short 3–5x flashes rather than the former near-flat sine.
            const flash=p.sparkle?Math.pow(Math.max(0,
                Math.sin(time*p.sparkleRate+p.sparklePhase)),18):0;
            const alpha=p.alpha*(.82+.18*ease)*edge*(simmer+flash*.70);
            pointSprite(x,y,p.radius,alpha,p.color,p.kind);
            // HDR-like additive halo plus warm-white pinprick at peak intensity.
            if(flash>.035){
                const intensity=Math.min(1,flash);
                pointSprite(x,y,p.radius*(p.kind==="sharp"?2.3:1.35),
                    intensity*.72,3,"blur");
                pointSprite(x,y,Math.max(.85,p.radius*.82),
                    intensity*.97,3,"sharp");
                if(flash>.43){
                    ctx.fillStyle=rgba([255,250,229],Math.min(.99,
                        intensity*(p.kind==="sharp"?.96:.64)));
                    ctx.beginPath();
                    ctx.arc(x,y,Math.max(.65,p.radius*.42),0,Math.PI*2);
                    ctx.fill();
                }
            }else if(p.kind==="blur" && i%7===0){
                pointSprite(x,y,1.0,alpha*.56,3,"sharp");
            }
        }
        ctx.restore();
        ctx.globalAlpha=1;
    }

    function paintSparseDust(time){
        const count=compact.matches?65:floaters.length;
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
        ctx.globalAlpha=1;
        ctx.globalCompositeOperation="source-over";
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
            // Start with the video's fully established 6-second composition.
            if(startedAt===null)startedAt=timestamp-6500;
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
        // Paint the first frame immediately; don't leave the page dark while
        // waiting for the first animation frame or on reduced-motion devices.
        paint(startedAt===null?6.5:12);
        if(!motionPreference.matches)raf=requestAnimationFrame(tick);
    }

    window.addEventListener("resize",refresh,{passive:true});
    document.addEventListener("visibilitychange",refresh);
    if(motionPreference.addEventListener)
        motionPreference.addEventListener("change",refresh);
    else if(motionPreference.addListener)
        motionPreference.addListener(refresh);
    refresh();
})();
