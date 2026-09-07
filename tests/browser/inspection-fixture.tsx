import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewFrame } from '../../app/preview-frame';
import { LiveInspector } from '../../app/live-inspector';
import type { InspectCommand, PreviewInspection, PreviewMode } from '../../lib/preview-inspection';
import '../../app/globals.css';

function Fixture() {
  const [mode, setMode] = useState<PreviewMode>('edit');
  const [tab, setTab] = useState<'design' | 'layers'>('design');
  const [value, setValue] = useState<PreviewInspection | null>(null);
  const [command, setCommand] = useState<InspectCommand>();
  const [revision, setRevision] = useState(0);
  const [comparisons, setComparisons] = useState(false);
  const request = (id?: string, generation?: string) => setCommand(prior => ({ sequence: (prior?.sequence ?? 0) + 1, nodeId: id, generation }));
  return <main style={{ padding:24, color:'#222', background:'white', minHeight:'100vh' }}>
    <h1 style={{ fontSize:24 }}>Live inspection regression fixture</h1>
    <div style={{ display:'flex', gap:16, margin:'16px 0' }}>
      <button onClick={() => setMode('edit')}>Edit</button><button onClick={() => setMode('prototype')}>Interact</button>
      <button onClick={() => setTab('design')}>Design</button><button onClick={() => setTab('layers')}>Layers</button>
      <button onClick={() => setRevision(n => n + 1)}>Reload frame</button><button onClick={() => setComparisons(true)}>Add comparison</button>
      <button onClick={() => request('n2', 'bb425bdd-3a2d-4bb7-8459-a86b7dffec2d')}>Stale selection</button>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 310px', gap:20 }}>
      <div style={{ position:'relative' }}><PreviewFrame key={revision} baseUrl="http://127.0.0.1:8793" route="/inspect" frameId="first" title="First page" style={{ width:'100%', height:650, border:'1px solid #ccc' }} mode={mode} onScroll={() => {}} onInspection={setValue} inspectCommand={command} />
        {comparisons && <PreviewFrame baseUrl="http://127.0.0.1:8793" route="/inspect" frameId="second" title="Second page" style={{ width:300, height:200 }} onScroll={() => {}} />}
      </div>
      <aside style={{ border:'1px solid #e4e5e8', borderRadius:12, padding:12 }}><LiveInspector tab={tab} inspection={value} available onRefresh={() => request()} onSelect={request} onSource={() => {}} onDiscuss={() => {}} /></aside>
    </div>
    <output hidden id="inspection">{JSON.stringify(value)}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
