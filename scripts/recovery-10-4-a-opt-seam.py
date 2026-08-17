from pathlib import Path
import re
p=Path('apps/web/src/physics/xpbd.ts');s=p.read_text();pat=r'function solveSeamSet\(state: XpbdState, dt: number\): void \{.*?\n\}\n\nfunction updateVelocitiesAndPositions'
rep='''function solveSeamSet(state: XpbdState, dt: number): void {
 const seams=state.seams,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt);let maxApplied=state.maximumCorrectionApplied;
 for(let i=0;i<seams.restDistances.length;i+=1){const b=i*4,p0=seams.indices[b],p1=seams.indices[b+1],p2=seams.indices[b+2],p3=seams.indices[b+3],w0=seams.weights[b],w1=seams.weights[b+1],w2=seams.weights[b+2],w3=seams.weights[b+3];
  let ax=0,ay=0,az=0,bx=0,by=0,bz=0;if(p0!==XPBD_MISSING_PARTICLE){const o=p0*3;ax+=pos[o]*w0;ay+=pos[o+1]*w0;az+=pos[o+2]*w0;}if(p1!==XPBD_MISSING_PARTICLE){const o=p1*3;ax+=pos[o]*w1;ay+=pos[o+1]*w1;az+=pos[o+2]*w1;}if(p2!==XPBD_MISSING_PARTICLE){const o=p2*3;bx+=pos[o]*w2;by+=pos[o+1]*w2;bz+=pos[o+2]*w2;}if(p3!==XPBD_MISSING_PARTICLE){const o=p3*3;bx+=pos[o]*w3;by+=pos[o+1]*w3;bz+=pos[o+2]*w3;}
  const dx=bx-ax,dy=by-ay,dz=bz-az,ls=dx*dx+dy*dy+dz*dz;if(ls<=EPSILON*EPSILON)continue;const len=Math.sqrt(ls);let c0=p0===XPBD_MISSING_PARTICLE?0:-w0,c1=p1===XPBD_MISSING_PARTICLE?0:-w1,c2=p2===XPBD_MISSING_PARTICLE?0:w2,c3=p3===XPBD_MISSING_PARTICLE?0:w3;
  if(c1&&p1===p0){c0+=c1;c1=0;}if(c2){if(p2===p0){c0+=c2;c2=0;}else if(c1&&p2===p1){c1+=c2;c2=0;}}if(c3){if(p3===p0){c0+=c3;c3=0;}else if(c1&&p3===p1){c1+=c3;c3=0;}else if(c2&&p3===p2){c2+=c3;c3=0;}}
  let mass=0,mm=Number.POSITIVE_INFINITY;const relax=seams.relaxations[i];const add=(p:number,c:number)=>{if(Math.abs(c)<=EPSILON)return;mass+=inv[p]*c*c;const wg=inv[p]*Math.abs(c);if(wg>EPSILON){const q=limits[p]*relax/wg;if(q<mm)mm=q;}};add(p0,c0);add(p1,c1);add(p2,c2);add(p3,c3);
  const cp=seams.compliances[i],alpha=(cp>0?cp:0)*alphaScale,den=mass+alpha;if(den<=EPSILON)continue;const raw=(-(len-seams.restDistances[i])-alpha*seams.lambdas[i])/den;if(!Number.isFinite(mm))mm=0;const dl=clampMultiplierByPositionCorrection(raw,mm);seams.lambdas[i]+=dl;const il=1/len,nx=dx*il,ny=dy*il,nz=dz*il;
  const apply=(p:number,c:number)=>{if(Math.abs(c)<=EPSILON)return;const sc=dl*c*inv[p],o=p*3;pos[o]+=nx*sc;pos[o+1]+=ny*sc;pos[o+2]+=nz*sc;const a=Math.abs(sc);if(a>maxApplied)maxApplied=a;};apply(p0,c0);apply(p1,c1);apply(p2,c2);apply(p3,c3);
 }state.maximumCorrectionApplied=maxApplied;
}

function updateVelocitiesAndPositions'''
s,n=re.subn(pat,rep,s,flags=re.S);assert n==1,n;p.write_text(s)
