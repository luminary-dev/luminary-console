import { getClient, saveClient, fetchAsset } from './lib/store.ts';
import { runStage2, saveDoc, archiveVersion, todayLabel } from './lib/pipeline.ts';
import { reviseDoc } from './lib/generate.ts';
import { quotationPaymentTerms } from './lib/pricing.ts';
import { parseAmount, fmtLKR } from './lib/money.ts';

const slug = 'eco-mech';
const BUDGET = 45000;
let c = await getClient(slug);
const today = todayLabel();

const res = await fetchAsset(c.answersUrl);
if(!res.ok){ console.log('answers missing'); process.exit(1); }
const answers = await res.json();
await runStage2(slug, answers, c.answersAt || '');
console.log('STEP1 stage2 done');

c = await getClient(slug);
const fixInstr = `The client has agreed a FIXED, all-in budget of exactly LKR 45,000 for this single landing-page project. Set the quotation total to exactly LKR 45,000 and rework the line items so their amounts sum to EXACTLY 45,000 (realistic and specific: e.g. UX & design, development, content/copy assembly). Use Luminary's 30/70 payment split. Do not exceed or fall short of 45,000.`;
let q = c.docs.quotation;
let qData = await reviseDoc(c, 'quotation', q.data, fixInstr, today);
qData.total = fmtLKR(BUDGET);
qData.paymentTerms = quotationPaymentTerms(BUDGET);
archiveVersion(q);
await saveDoc(c, 'quotation', qData, q.status);
const sum = (qData.lineItems||[]).reduce((a,li)=>a+(parseAmount(li.amount)||0),0);
console.log('STEP2 quotation total', qData.total, '| line-item sum', fmtLKR(sum), sum===BUDGET?'(exact)':'(differs!)');

for(const t of ['proposal','contract']){
  const m = c.docs[t];
  const ctx = `${fixInstr}\n\nApply the SAME fixed budget to this ${t} and keep it fully consistent with the quotation just fixed at LKR 45,000. The revised quotation now reads:\n${JSON.stringify(qData)}`;
  const d = await reviseDoc(c, t, m.data, ctx, today);
  archiveVersion(m);
  await saveDoc(c, t, d, m.status);
  console.log('STEP3 '+t+' done');
}
await saveClient(c);
console.log('ALL DONE');
