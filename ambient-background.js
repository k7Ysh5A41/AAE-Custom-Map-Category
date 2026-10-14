"use strict";

// Lightweight, original PS5-login-inspired atmosphere: drifting light,
// translucent waves, and sparse bokeh behind the map catalog.
(() => {
    const canvas = document.getElementById("ambientBackground");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", {alpha:true, desynchronized:true});
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const smallScreen = window.matchMedia("(max-width: 700px)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let previousFrame = -Infinity;
    let initialTime = null;

    // Seeded distribution keeps the particles stable through re-renders.
    let seed = 501311;
    const random = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const particles = Array.from({length:50}, () => ({
        x:random(), y:random(), radius:.65 + random()*2.0,
        speed:.008+random()*.017, phase:random()*Math.PI*2,
        sparkle:random()*.6+.4, tone:random()>.58?"warm":"cool"
    }));

    function sizeCanvas() {
        width = Math.max(1,window.innerWidth);
        height = Math.max(1,window.innerHeight);
        // Bound full-screen redraw cost even on high-DPI / 4K monitors.
        const resolution = Math.min(window.devicePixelRatio || 1,1.35,
            Math.sqrt(2400000/(width*height)));
        const backingScale = Math.max(.35,resolution);
        canvas.width = Math.max(1,Math.floor(width*backingScale));
        canvas.height = Math.max(1,Math.floor(height*backingScale));
        ctx.setTransform(backingScale,0,0,backingScale,0,0);
    }

    function halo(x,y,r,inner,outer) {
        const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
        gradient.addColorStop(0,inner);
        gradient.addColorStop(1,outer);
        ctx.fillStyle=gradient;
        ctx.fillRect(x-r,y-r,r*2,r*2);
    }

    function drawWaves(t) {
        const motion=Math.sin(t*.13), drift=Math.cos(t*.10);
        // Broad, diffuse portal-light layers.
        halo(width*(.20+motion*.06),height*.72,width*.65,
            "rgba(47,79,139,.115)","rgba(15,30,61,0)");
        halo(width*(.84+drift*.04),height*(.59+motion*.025),width*.56,
            "rgba(85,103,163,.11)","rgba(12,22,52,0)");
        halo(width*.52,height*(.83+drift*.02),width*.45,
            "rgba(150,113,88,.047)","rgba(24,28,47,0)");

        const left=-width*.15, right=width*1.15;
        for(let i=0;i<10;i++){
            const depth=i/9;
            const sway=Math.sin(t*.21+depth*2.1)*height*.029;
            const y=height*(.59+depth*.038)+sway;
            const gradient=ctx.createLinearGradient(left,0,right,0);
            gradient.addColorStop(0,"rgba(116,151,210,0)");
            gradient.addColorStop(.22,`rgba(116,164,224,${.015+depth*.027})`);
            gradient.addColorStop(.55,`rgba(200,207,224,${.042+depth*.031})`);
            gradient.addColorStop(.83,`rgba(115,157,216,${.03+depth*.021})`);
            gradient.addColorStop(1,"rgba(116,151,210,0)");
            ctx.beginPath();
            ctx.moveTo(left,y-height*.1);
            ctx.bezierCurveTo(width*.18,y+height*(.18-depth*.04),
                width*.66,y-height*(.21-depth*.035),right,y+height*.042);
            ctx.strokeStyle=gradient;
            ctx.lineWidth=1.05+(1-depth)*1.2;
            ctx.stroke();
        }
        // A pair of quiet mist-like arcs, well below the primary controls.
        for(let i=0;i<2;i++){
            const wave=Math.sin(t*.17+i*2.3)*height*.03;
            const y=height*(.79+i*.1)+wave;
            const beam=ctx.createLinearGradient(0,y,width,y);
            beam.addColorStop(0,"rgba(103,144,212,0)");
            beam.addColorStop(.35,"rgba(117,151,209,.08)");
            beam.addColorStop(.72,"rgba(161,162,195,.08)");
            beam.addColorStop(1,"rgba(103,144,212,0)");
            ctx.beginPath();
            ctx.moveTo(-width*.2,y);
            ctx.bezierCurveTo(width*.25,y-height*.18,
                width*.78,y+height*.11,width*1.2,y-height*.055);
            ctx.lineWidth=9+i*7;
            ctx.strokeStyle=beam;
            ctx.stroke();
        }
    }

    function drawParticles(t) {
        const count=smallScreen.matches?23:particles.length;
        for(let i=0;i<count;i++){
            const p=particles[i];
            const cycle=(p.x+t*p.speed)%1;
            const x=cycle*width;
            const y=height*(.31+p.y*.59)+Math.sin(t*.23+p.phase)*height*.027;
            const shimmer=.55+.45*Math.sin(t*(.57+p.sparkle)+p.phase);
            const alpha=(.038+p.sparkle*.13)*shimmer;
            if(i%7===0){
                const color=p.tone==="warm"
                    ?`rgba(242,204,149,${alpha*.17})`
                    :`rgba(183,213,255,${alpha*.15})`;
                halo(x,y,p.radius*10,color,"rgba(12,19,41,0)");
            }
            ctx.beginPath();
            ctx.arc(x,y,p.radius,0,Math.PI*2);
            ctx.fillStyle=p.tone==="warm"
                ?`rgba(245,210,167,${alpha})`
                :`rgba(198,223,255,${alpha})`;
            ctx.fill();
        }
    }

    function draw(seconds) {
        ctx.clearRect(0,0,width,height);
        drawWaves(seconds);
        drawParticles(seconds);
    }

    function loop(timestamp) {
        frame=0;
        if(document.hidden || reducedMotion.matches) return;
        const interval=smallScreen.matches?50:40;
        if(timestamp-previousFrame>=interval){
            previousFrame=timestamp;
            if(initialTime===null)initialTime=timestamp;
            draw((timestamp-initialTime)/1000);
        }
        frame=requestAnimationFrame(loop);
    }

    function refresh() {
        cancelAnimationFrame(frame);
        frame=0;
        sizeCanvas();
        previousFrame=-Infinity;
        if(document.hidden) return;
        if(reducedMotion.matches){
            draw(0);
        } else {
            frame=requestAnimationFrame(loop);
        }
    }

    window.addEventListener("resize",refresh,{passive:true});
    document.addEventListener("visibilitychange",refresh);
    if(typeof reducedMotion.addEventListener==="function")
        reducedMotion.addEventListener("change",refresh);
    else if(typeof reducedMotion.addListener==="function")
        reducedMotion.addListener(refresh);
    refresh();
})();
