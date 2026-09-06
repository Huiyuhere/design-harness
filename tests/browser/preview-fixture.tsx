import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewFrame } from '../../app/preview-frame';
import { scheduleFrameSurfaces, EMPTY_SCROLL, type ScrollSnapshot } from '../../lib/frame-runtime';
import { browserPreviewDrafts } from '../../lib/preview-drafts';

function Fixture() {
  const [snapshots, setSnapshots] = useState<Record<string, ScrollSnapshot>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [pins, setPins] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [draftStatus, setDraftStatus] = useState('');
  const frames = Array.from({length:90},(_,i)=>({id:`frame-${i}`,sourceRouteId:`route-${i%30}`,x:0,y:0,width:430,height:300,pinned:pins}));
  const schedule = scheduleFrameSurfaces(frames,'frame-0',zoom,focus,3);
  const surface = (id:string) => <PreviewFrame key={id} baseUrl="http://127.0.0.1:8793" route="/fixture?step=2" frameId={id} title={id} style={{width:400,height:300}} scroll={snapshots[id]??EMPTY_SCROLL} onScroll={s=>setSnapshots(v=>({...v,[id]:s}))} />;
  return <><h1>Actual iframe / bridge regression fixture</h1><button onClick={()=>setPins(true)}>Pin comparisons</button><button onClick={()=>setFocus('frame-0')}>Focus first</button><button onClick={()=>setFocus(null)}>Close focus</button><button onClick={()=>setZoom(.4)}>Zoom out</button><button onClick={()=>setZoom(1)}>Zoom in</button>
    <button onClick={async()=>{await browserPreviewDrafts.save({key:'browser-regression',files:[{path:'page.tsx',before:'original',after:'approved edit'}]});setDraftStatus('Saved');}}>Save source draft</button>
    <button onClick={async()=>{const draft=await browserPreviewDrafts.load('browser-regression');setDraftStatus(draft?.files[0]?.after??'Missing');}}>Read source draft</button><output id="draft-status">{draftStatus}</output>
    <output id="snapshots">{JSON.stringify(snapshots)}</output><output id="count">{schedule.total}</output><div id="canvas">{schedule.canvas.map(surface)}</div>{schedule.focus&&<div id="focus">{surface(schedule.focus)}</div>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
