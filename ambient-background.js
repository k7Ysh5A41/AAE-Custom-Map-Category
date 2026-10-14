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
    const COLORS=[
        [250,86,48],   // AAE orange
        [236,80,36],   // ember orange
        [255,178,119], // AAE active-category highlight
        [255,223,184], // soft ivory
        [247,197,148]  // subtle golden dust
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
    const streams=Array.from({length:560},(_,i)=>{
        const depth=rand();
        const bokeh=rand()<.115;
        const sharp=!bokeh && rand()<.48;
        return {
            u:rand(),
            lane:rand()<.36?-1:rand()<.52?0:1,
            scatter:normal()*(.027+depth*.029),
            drift:between(.006,.019)*(1+depth*.4),
            bob:between(.001,.009),
            phase:between(0,Math.PI*2),
            blink:between(.17,.71),
            color:rand()<.17?0:rand()<.35?1:rand()<.60?2:rand()<.65?3:4,
            kind:bokeh?"blur":sharp?"sharp":"mist",
            radius:bokeh?between(3.8,8.5):sharp?between(.8,2.2):between(1.2,4.1),
            alpha:bokeh?between(.17,.60):sharp?between(.17,.69):between(.07,.34)
        };
    });
    const floaters=Array.from({length:110},()=>({
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
        // Wide upper-left diffuse ceiling light, matching the video framing.
        const x=width*(.12+Math.sin(time*.067)*.014);
        const bloom=[234,198,184];
        ellipticalGlow(x,-height*.12,width*.47,height*.72,bloom,.24);
        ellipticalGlow(x,height*.04,width*.24,height*.48,[218,178,164],.093);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x-width*.11,-height*.13);
        ctx.lineTo(x+width*.09,-height*.13);
        ctx.lineTo(x+width*.42,height*.85);
        ctx.lineTo(x-width*.28,height*.83);
        ctx.closePath();
        const shaft=ctx.createLinearGradient(x,0,x,height*.85);
        shaft.addColorStop(0,"rgba(235,191,168,.12)");
        shaft.addColorStop(.37,"rgba(214,168,147,.036)");
        shaft.addColorStop(1,"rgba(214,168,147,0)");
        ctx.fillStyle=shaft;
        ctx.fill();
        ctx.restore();
    }

    function paintMist(time){
        // A low, drifting milky cloud anchors the flow below the map UI.
        const move=Math.sin(time*.11)*width*.022;
        ellipticalGlow(width*.13+move,height*.86,width*.46,height*.23,
            [184,172,162],.155);
        ellipticalGlow(width*.36-move*.55,height*.93,width*.49,height*.18,
            [123,118,124],.086);
        ellipticalGlow(width*.71+move*.25,height*.76,width*.50,height*.27,
            [115,101,96],.032);

        // The "ribbon" is atmospheric, not a solid sheet: a few exceptionally
        // soft, wide arcs beneath the flowing particles.
        ctx.save();
        for(let i=0;i<3;i++){
            const g=ctx.createLinearGradient(-width*.1,0,width*1.1,0);
            g.addColorStop(0,"rgba(200,162,144,0)");
            g.addColorStop(.24,"rgba(200,162,144,.012)");
            g.addColorStop(.52,"rgba(235,182,147,.023)");
            g.addColorStop(.75,"rgba(250,117,65,.013)");
            g.addColorStop(1,"rgba(250,117,65,0)");
            ctx.beginPath();
            for(let j=0;j<=35;j++){
                const u=j/35;
                const px=width*(u*1.24-.12);
                const py=height*(streamY(u,time*.48,i-1)+.025);
                if(j===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
            }
            ctx.strokeStyle=g;
            ctx.lineWidth=height*(.05+i*.038);
            ctx.stroke();
        }
        ctx.restore();
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
        const count=compact.matches?240:streams.length;
        for(let i=0;i<count;i++){
            const p=streams[i];
            // Positive drift across the river; particles recycle beyond view.
            const u=(p.u+time*p.drift)%1;
            const x=width*(u*1.29-.145);
            const y=height*(streamY(u,time,p.lane)+p.scatter+
                Math.sin(time*.27+p.phase)*p.bob);
            if(x<-18||x>width+18||y<-18||y>height+18)continue;
            const edge=Math.pow(Math.max(0,Math.sin(Math.PI*u)),.42);
            const twinkle=.77+.23*Math.sin(time*(.65+p.blink)+p.phase);
            const alpha=p.alpha*edge*twinkle;
            pointSprite(x,y,p.radius,alpha,p.color,p.kind);
            // Occasional tiny sharp centers on the brightest defocused motes.
            if(p.kind==="blur" && i%8===0)
                pointSprite(x,y,1.1,alpha*.44,3,"sharp");
        }
        ctx.globalAlpha=1;
    }

    function paintSparseDust(time){
        const count=compact.matches?45:floaters.length;
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
