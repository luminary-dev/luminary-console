import { getClient, saveClient } from './lib/store.ts';
import { deploymentStatus } from './lib/deploy.ts';
const slug='eco-mech';
let done=false;
for (let i=0;i<24 && !done;i++){
  await new Promise(r=>setTimeout(r, 15000));
  let s;
  try { s = await deploymentStatus((await getClient(slug)).site.deployId); } catch(e){ console.log('poll error', e.message); continue; }
  console.log(new Date().toISOString().slice(11,19), 'state:', s.state, s.url||'');
  if (s.state==='READY' || s.state==='ERROR' || s.state==='CANCELED'){
    const c = await getClient(slug);
    c.site.state = s.state;
    if (s.state==='READY' && !c.site.deployedAt) c.site.deployedAt = new Date().toISOString();
    if (!c.site.host && s.url) c.site.url = s.url;
    c.site.updatedAt = new Date().toISOString();
    await saveClient(c);
    console.log('FINAL:', s.state, '| site url:', c.site.url);
    done=true;
  }
}
if(!done) console.log('still building after ~6min — check the console / inspector.');
