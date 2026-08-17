from pathlib import Path
import re
p=Path('apps/web/src/physics/xpbd.ts');s=p.read_text();pat=r'function solveShearSet\(state: XpbdState, dt: number\): void \{.*?\n\}\n\nfunction solveSeamSet'
rep='''function solveShearSet(state: XpbdState, dt: number): void {
 const set=state.shears,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt);let maxApplied=state.maximumCorrectionApplied;
 for(let i=0;i<set.restCosines.length;i+=1){
  const k=i*3,p0=set.indices[k],p1=set.indices[k+1],p2=set.indices[k+2],o0=p0*3,o1=p1*3,o2=p2*3;
  const e1x=pos[o1]-pos[o0],e1y=pos[o1+1]-pos[o0+1],e1z=pos[o1+2]-pos[o0+2],e2x=pos[o2]-pos[o0],e2y=pos[o2+1]-pos[o0+1],e2z=pos[o2+2]-pos[o0+2];
  const l1s=e1x*e1x+e1y*e1y+e1z*e1z,l2s=e2x*e2x+e2y*e2y+e2z*e2z;if(l1s<=EPSILON*EPSILON||l2s<=EPSILON*EPSILON)continue;
  const l1=Math.sqrt(l1s),l2=Math.sqrt(l2s),i1=1/l1,i2=1/l2,ux=e1x*i1,uy=e1y*i1,uz=e1z*i1,vx=e2x*i2,vy=e2y*i2,vz=e2z*i2,cos=ux*vx+uy*vy+uz*vz;
  const g1x=(vx-cos*ux)*i1,g1y=(vy-cos*uy)*i1,g1z=(vz-cos*uz)*i1,g2x=(ux-cos*vx)*i2,g2y=(uy-cos*vy)*i2,g2z=(uz-cos*vz)*i2,g0x=-(g1x+g2x),g0y=-(g1y+g2y),g0z=-(g1z+g2z);
  const q0=g0x*g0x+g0y*g0y+g0z*g0z,q1=g1x*g1x+g1y*g1y+g1z*g1z,q2=g2x*g2x+g2y*g2y+g2z*g2z,w0=inv[p0],w1=inv[p1],w2=inv[p2],c=set.compliances[i],alpha=(c>0?c:0)*alphaScale,den=w0*q0+w1*q1+w2*q2+alpha;if(den<=EPSILON)continue;
  const raw=(-(cos-set.restCosines[i])-alpha*set.lambdas[i])/den,m0=Math.sqrt(q0),m1=Math.sqrt(q1),m2=Math.sqrt(q2);let mm=Number.POSITIVE_INFINITY,wg=w0*m0;
  if(wg>EPSILON)mm=limits[p0]/wg;wg=w1*m1;if(wg>EPSILON){const q=limits[p1]/wg;if(q<mm)mm=q;}wg=w2*m2;if(wg>EPSILON){const q=limits[p2]/wg;if(q<mm)mm=q;}if(!Number.isFinite(mm))mm=0;
  const dl=clampMultiplierByPositionCorrection(raw,mm);set.lambdas[i]+=dl;const s0=dl*w0,s1=dl*w1,s2=dl*w2;
  pos[o0]+=g0x*s0;pos[o0+1]+=g0y*s0;pos[o0+2]+=g0z*s0;pos[o1]+=g1x*s1;pos[o1+1]+=g1y*s1;pos[o1+2]+=g1z*s1;pos[o2]+=g2x*s2;pos[o2+1]+=g2y*s2;pos[o2+2]+=g2z*s2;
  const applied=Math.abs(dl)*Math.max(w0*m0,w1*m1,w2*m2);if(applied>maxApplied)maxApplied=applied;
 }state.maximumCorrectionApplied=maxApplied;
}

function solveSeamSet'''
s,n=re.subn(pat,rep,s,flags=re.S);assert n==1,n;p.write_text(s)
