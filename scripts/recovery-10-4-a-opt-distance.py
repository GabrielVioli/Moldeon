from pathlib import Path
import re
p=Path('apps/web/src/physics/xpbd.ts');s=p.read_text()
pat=r'function solveDistanceSet\(state: XpbdState, dt: number, kind: 0 \| 1\): void \{.*?\n\}\n\nfunction solveShearSet'
rep='''function solveDistanceSet(state: XpbdState, dt: number, kind: 0 | 1): void {
  const set=state.distances,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt); let maxApplied=state.maximumCorrectionApplied;
  for(let i=0;i<set.restLengths.length;i+=1){
    if(set.kinds[i]!==kind)continue; const k=i*2,a=set.indices[k],b=set.indices[k+1],oa=a*3,ob=b*3;
    const dx=pos[ob]-pos[oa],dy=pos[ob+1]-pos[oa+1],dz=pos[ob+2]-pos[oa+2],ls=dx*dx+dy*dy+dz*dz; if(ls<=EPSILON*EPSILON)continue;
    const len=Math.sqrt(ls),wa=inv[a],wb=inv[b],c=set.compliances[i],alpha=(c>0?c:0)*alphaScale,den=wa+wb+alpha; if(den<=EPSILON)continue;
    const raw=(-(len-set.restLengths[i])-alpha*set.lambdas[i])/den; let mm=Number.POSITIVE_INFINITY;
    if(wa>EPSILON)mm=limits[a]/wa; if(wb>EPSILON){const q=limits[b]/wb;if(q<mm)mm=q;} if(!Number.isFinite(mm))mm=0;
    const dl=clampMultiplierByPositionCorrection(raw,mm); set.lambdas[i]+=dl; const il=1/len,nx=dx*il,ny=dy*il,nz=dz*il,sa=dl*wa,sb=dl*wb;
    pos[oa]-=nx*sa;pos[oa+1]-=ny*sa;pos[oa+2]-=nz*sa;pos[ob]+=nx*sb;pos[ob+1]+=ny*sb;pos[ob+2]+=nz*sb;
    const applied=Math.abs(dl)*(wa>wb?wa:wb);if(applied>maxApplied)maxApplied=applied;
  } state.maximumCorrectionApplied=maxApplied;
}

function solveShearSet'''
s,n=re.subn(pat,rep,s,flags=re.S);assert n==1,n;p.write_text(s)
