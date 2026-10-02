/** Browser fixture only: renders the real palette with synthetic commands and providers. */
import { useEffect,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search } from 'lucide-react';
import { CommandPalette } from '../src/components/command-palette/CommandPalette';
import { INTENTS } from '../src/lib/intelligent-router';
import '../src/index.css';
function Fixture(){
  const [open,setOpen]=useState(false),[focus,setFocus]=useState(0),[rtl,setRtl]=useState(false),[selected,setSelected]=useState(''),[mobile,setMobile]=useState(window.innerWidth<640);
  useEffect(()=>{const resize=()=>setMobile(window.innerWidth<640);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setOpen(true);setFocus(f=>f+1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const commands=INTENTS.filter(i=>i.key!=='hiring').map(i=>({id:i.commandId,type:'navigation' as const,group:'workspace' as const,label:rtl?i.aliases.find(a=>/[\u0600-\u06ff]/u.test(a))??i.key:i.aliases[0],description:i.description,keywords:[i.aliases[0]],icon:<Search/>,execute:()=>setSelected(i.key),mobileAvailable:true,dangerous:false as const,pinnable:false}));
  return <main className="p-6"><h1>Stanza router browser fixture</h1><p>Mock providers and in-memory review only. No PostgreSQL or employee data.</p><button className="m-3 border p-3" onClick={()=>{setOpen(true);setFocus(f=>f+1);}}>Open palette (Ctrl+K)</button><button className="m-3 border p-3" onClick={()=>setRtl(v=>!v)}>Arabic / English</button><output aria-label="Selected intent">{selected}</output>
    {open&&<CommandPalette commands={commands} recentCommandIds={[]} focusRequest={focus} isMobileLayout={mobile} isRtl={rtl} onClose={()=>setOpen(false)} onExecute={c=>{c.execute();setOpen(false);}} labels={{title:'Stanza Command Palette',searchPlaceholder:rtl?'اسأل Stanza…':'Ask Stanza…',close:'Close palette',clearSearch:'Clear search',noResults:rtl?'لا توجد أوامر مطابقة':'No matching commands',resultCount:n=>`${n} commands`,keyboardHelp:'Arrows, Enter, Escape',mobileHelp:'Search or tap a command',viewAllCommands:n=>`View all ${n} commands`,groups:{workspace:'Workspace',recent:'Recent',peopleOperations:'People',administration:'Administration',quickActions:'Quick actions',settings:'Settings'}}}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
