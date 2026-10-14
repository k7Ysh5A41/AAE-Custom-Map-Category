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

    // The reference particles form a deep, irregular ribbon rising from the
    // lower-left toward the mid-right. Most dots drift slowly, not in formation.
    function streamY(u,time,lane){
        const t=Math.max(0,Math.min(1,(u-.06)/.91));
        const climb=(1-Math.exp(-3.1*t))/(1-Math.exp(-3.1));
        const subtleWave=.009*Math.sin(u*7.4-time*.12+lane*1.6);
        return .85-.38*climb+lane*(.065+.021*t)+subtleWave;
    }

    // Stable seeded depth layers with independent motion and loose clusters.
    const streams=Array.from({length:940},()=>{
        const depth=rand();
        const bokeh=rand()<.205;
        const sharp=!bokeh&&rand()<.61;
        const chance=rand();
        const u=chance<.34?between(.66,1.13):
                chance<.48?between(.06,.34):between(0,1.15);
        const lane=between(-1,1);
        const direction=rand()<.15?-1:1;
        const movement=between(.0014,.0067)*(0.70+depth*.95)*direction;
        return {
            u,
            initialY:between(.27,1.05),
            lane,
            scatter:normal()*(.051+depth*.024+u*.018),
            drift:movement,
            bob:between(.001,.010),
            phase:between(0,Math.PI*2),
            blink:between(.12,.48),
            sparkle:rand()<.33,
            sparkleRate:between(.45,1.20),
            sparklePhase:between(0,Math.PI*2),
            color:(()=>{const v=rand();return v<.13?0:v<.32?1:v<.60?2:v<.89?3:4;})(),
            kind:bokeh?"blur":sharp?"sharp":"mist",
            radius:bokeh?between(2.3,8.8):sharp?between(.75,2.15):between(1.3,4.0),
            alpha:bokeh?between(.26,.66):sharp?between(.42,.88):between(.12,.39)
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

    // Reference lighting: a wide, soft near-vertical canopy from upper left.
    // A SINGLE precomputed alpha field blends broad atmospheric illumination,
    // diffused shafts and tiny variation with no discrete layered ray edges.
    function makeGodRayTexture(){
        const w=compact.matches?512:768,h=compact.matches?360:480;
        const bitmap=document.createElement("canvas");
        bitmap.width=w;
        bitmap.height=h;
        const brush=bitmap.getContext("2d");
        if(!brush)return null;
        const pixels=brush.createImageData(w,h);
        const data=pixels.data;
        const gaussian=(x,c,s)=>Math.exp(-Math.pow((x-c)/s,2));
        for(let y=0;y<h;y++){
            const v=(y+.5)/h;
            const depth=(v+.18)/1.18;
            const spread=.20+.53*depth;
            const decay=Math.exp(-depth*.82);
            for(let x=0;x<w;x++){
                const u=(x+.5)/w;
                // Ray directions are measured from a common upper-left source.
                const slope=(u-.115)/(depth*.65+.025);
                const envelope=gaussian(u,.115+depth*.08,spread);
                const longShafts=
                    .43*gaussian(slope,.08,.36)
                   +.25*gaussian(slope,-.39,.34)
                   +.105*gaussian(slope,.73,.33)
                   +.045*gaussian(slope,1.45,.48);
                const microDetail=
                    .024*Math.sin(slope*29+v*3.1)
                   +.016*Math.sin(slope*58-v*2.4)
                   +.009*Math.sin(slope*103+v*6.4);
                const radiance=Math.max(0,
                    (.23+longShafts+microDetail)*envelope*decay);
                const k=(y*w+x)*4;
                data[k]=255;data[k+1]=215;data[k+2]=188;
                data[k+3]=Math.min(255,Math.round(207*radiance));
            }
        }
        brush.putImageData(pixels,0,0);
        return bitmap;
    }
    const godRayTexture=makeGodRayTexture();
    function paintGodRays(time){
        if(!godRayTexture)return;
        ctx.save();
        ctx.globalCompositeOperation="screen";
        ctx.globalAlpha=.89+.06*Math.sin(time*.10);
        ctx.drawImage(godRayTexture,0,0,width,height);
        ctx.restore();
    }

    function paintSpotlight(time){
        const intro=Math.min(1,Math.max(0,time/2.2));
        const x=width*.115;
        // The video has a gentle bloom just outside the upper-left edge.
        ellipticalGlow(x,-height*.065,width*.23,height*.31,
            [239,205,185],.27+.07*intro);
        ellipticalGlow(x+width*.035,height*.16,width*.32,height*.62,
            [193,162,147],.085);
        paintGodRays(time);
    }

    function paintMist(time){
        const reveal=Math.min(1,.35+time/7);
        const move=Math.sin(time*.09)*width*.014;
        // Desaturated low-left floor haze follows the reference video.
        ellipticalGlow(width*.15+move,height*.90,width*.56,height*.27,
            [157,142,131],.24*reveal);
        ellipticalGlow(width*.35-move*.5,height*.81,width*.51,height*.22,
            [137,112,105],.12*reveal);
        ellipticalGlow(width*.74,height*.61,width*.39,height*.23,
            [104,91,89],.045*reveal);
        // Very faint local fog patches, not an opaque ribbon.
        for(let i=0;i<5;i++){
            const u=(i+.5)/5;
            const px=width*(u*1.16-.10);
            const py=height*(streamY(u,time*.20,0)+.08);
            ellipticalGlow(px,py,width*.16,height*.10,
                [170,132,110],(.021+.007*Math.sin(time*.13+i))*reveal);
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
            // Wrap well beyond both screen edges: no visible teleportation.
            const u=((p.u+time*p.drift)%1.15+1.15)%1.15;
            const x=width*(u*1.16-.10);
            const formed=Math.max(0,Math.min(1,(time-.2)/5));
            const ease=formed*formed*(3-2*formed);
            const waveY=streamY(u,time,p.lane)+p.scatter+
                Math.sin(time*.26+p.phase)*p.bob;
            const y=height*(p.initialY*(1-ease)+waveY*ease);
            if(x<-55||x>width+55||y<-55||y>height+55)continue;
            const edge=.47+.53*Math.pow(Math.max(0,
                Math.sin(Math.PI*Math.min(1,u))),.43);
            const simmer=.55+.14*Math.sin(time*(.23+p.blink)+p.phase);
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
