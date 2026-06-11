// tools/lowpoly-generator.js — reference script (run via run_script) that
// produced pixie-poly-face.svg from uploads/WhatsApp Image ... 4.07.26 PM.jpeg.
// Reuse for new poses: change `src`, crop (sx,sy,sw,sh), and feature points.
//
// Pipeline: crop+downscale photo -> adaptive jittered point set (denser where
// local contrast is high; explicit rings on eyes/nose) -> Bowyer-Watson
// Delaunay -> per-triangle color sampled from photo (+contrast/sat boost)
// -> SVG of <polygon>s (stroke=fill to hide seams).
//
// Tuning knobs: S (base grid step; smaller = more facets), variance
// thresholds (38/78), contrast 1.13 / saturation 1.14, W (working width).
/*
const src = "uploads/WhatsApp Image 2026-06-09 at 4.07.26 PM.jpeg";
const img = await readImage(src);
const sx=8, sy=250, sw=926, sh=1245;
const W=520, H=Math.round(W*sh/sw);
const cv = createCanvas(W,H); const ctx=cv.getContext('2d');
ctx.drawImage(img, sx,sy,sw,sh, 0,0,W,H);
const id = ctx.getImageData(0,0,W,H).data;
const cl=(v,m)=> v<0?0:(v>m?m:v);
const idx=(x,y)=> ((cl(y|0,H-1))*W+cl(x|0,W-1))*4;
const lum=(x,y)=>{const i=idx(x,y);return 0.299*id[i]+0.587*id[i+1]+0.114*id[i+2];};
const adj=(c)=>{let r=128+(c[0]-128)*1.13,g=128+(c[1]-128)*1.13,b=128+(c[2]-128)*1.13;const m=(r+g+b)/3;const s=1.14;r=m+(r-m)*s;g=m+(g-m)*s;b=m+(b-m)*s;return [cl(Math.round(r),255),cl(Math.round(g),255),cl(Math.round(b),255)];};
const colorAt=(x,y)=>{const i=idx(x,y);return [id[i],id[i+1],id[i+2]];};
const pts=[];
const push=(x,y,j=0.6)=>{const xx=x+(Math.random()-.5)*j,yy=y+(Math.random()-.5)*j;if(xx<-2||yy<-2||xx>W+2||yy>H+2)return;pts.push([xx,yy]);};
for(let x=0;x<=W;x+=44){push(x,0,0);push(x,H,0);}
for(let y=0;y<=H;y+=44){push(0,y,0);push(W,y,0);}
const S=22;
for(let gy=S/2;gy<H;gy+=S){for(let gx=S/2;gx<W;gx+=S){
  push(gx,gy,S*0.85);
  let mn=255,mx=0;
  for(let dy=-S/2;dy<=S/2;dy+=4)for(let dx=-S/2;dx<=S/2;dx+=4){const l=lum(gx+dx,gy+dy);if(l<mn)mn=l;if(l>mx)mx=l;}
  const v=mx-mn;
  if(v>38){push(gx-S/3,gy-S/4,S*0.5);push(gx+S/3,gy+S/4,S*0.5);}
  if(v>78){push(gx,gy-S/3,S*0.4);push(gx-S/4,gy+S/3,S*0.4);push(gx+S/4,gy,S*0.4);}
}}
// feature rings: eyes + nose (coords in source-photo space, mapped to crop)
const eyes=[[(320-sx)*W/sw,(792-sy)*H/sh],[(612-sx)*W/sw,(806-sy)*H/sh]];
const noseP=[(462-sx)*W/sw,(958-sy)*H/sh];
const ringR=80*W/sw;
for(const [ex,ey] of eyes){push(ex,ey,1);for(let k=0;k<16;k++){const a=k/16*Math.PI*2;push(ex+Math.cos(a)*ringR,ey+Math.sin(a)*ringR,1.5);push(ex+Math.cos(a)*ringR*0.6,ey+Math.sin(a)*ringR*0.6,1.5);}push(ex-ringR*0.32,ey-ringR*0.36,1);}
push(noseP[0],noseP[1],1);
for(let k=0;k<8;k++){const a=k/8*Math.PI*2;push(noseP[0]+Math.cos(a)*18,noseP[1]+Math.sin(a)*14,1.5);}
// Bowyer-Watson Delaunay
function circum(ax,ay,bx,by,cx,cy){const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(d)<1e-9)return null;const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy;const ux=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d,uy=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d;return [ux,uy,(ux-ax)**2+(uy-ay)**2];}
const M=Math.max(W,H)*10;const P=pts.slice();P.push([-M,-M],[M*2,-M],[-M,M*2]);const n=pts.length;
let tris=[[n,n+1,n+2]];const cc=new Map();const key=t=>t.join(',');
function getC(t){const k=key(t);let c=cc.get(k);if(!c){c=circum(P[t[0]][0],P[t[0]][1],P[t[1]][0],P[t[1]][1],P[t[2]][0],P[t[2]][1])||[0,0,-1];cc.set(k,c);}return c;}
for(let i=0;i<n;i++){const px=P[i][0],py=P[i][1];const bad=[];for(const t of tris){const c=getC(t);if(c[2]>=0&&(px-c[0])**2+(py-c[1])**2<=c[2])bad.push(t);}const edges=new Map();for(const t of bad){for(const e of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){const k=e[0]<e[1]?e[0]+'_'+e[1]:e[1]+'_'+e[0];edges.set(k,(edges.get(k)||0)+1);}}const bs=new Set(bad.map(key));tris=tris.filter(t=>!bs.has(key(t)));for(const t of bad){for(const e of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){const k=e[0]<e[1]?e[0]+'_'+e[1]:e[1]+'_'+e[0];if(edges.get(k)===1)tris.push([e[0],e[1],i]);}}}
tris=tris.filter(t=>t[0]<n&&t[1]<n&&t[2]<n);
let poly='';
for(const t of tris){const a=P[t[0]],b=P[t[1]],c=P[t[2]];const cx=(a[0]+b[0]+c[0])/3,cy=(a[1]+b[1]+c[1])/3;let r=0,g=0,bl=0,ns=0;for(const [sxp,syp] of [[cx,cy],[(a[0]+cx)/2,(a[1]+cy)/2],[(b[0]+cx)/2,(b[1]+cy)/2],[(c[0]+cx)/2,(c[1]+cy)/2]]){const col=colorAt(sxp,syp);r+=col[0];g+=col[1];bl+=col[2];ns++;}const col=adj([r/ns,g/ns,bl/ns]);const f=`rgb(${col[0]},${col[1]},${col[2]})`;poly+=`<polygon points="${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}" fill="${f}" stroke="${f}" stroke-width="0.8"/>`;}
await saveFile("pixie-poly-face.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="geometricPrecision"><g stroke-linejoin="round">${poly}</g></svg>`);
log("pts:"+n+" tris:"+tris.length);
*/
