import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true,protocolTimeout:120000});
for (const [theme, emu] of [['light',[]],['dark',[{name:'prefers-color-scheme',value:'dark'}]]]) {
  const page = await b.newPage();
  await page.setViewport({width:1200,height:900,deviceScaleFactor:1});
  if(emu.length) await page.emulateMediaFeatures(emu);
  await page.goto('https://eco-mech.luminary-dev.xyz/',{waitUntil:'networkidle0',timeout:60000}).catch(e=>console.log('goto:',e.message));
  await page.screenshot({path:`/tmp/portal-${theme}.png`, fullPage:true});
  console.log(theme,'shot done');
  await page.close();
}
await b.close();
