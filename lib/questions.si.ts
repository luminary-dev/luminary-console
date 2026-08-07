// Sinhala for the questionnaire. Keyed by SECTION ID and FIELD ID rather
// than by English string, because several base-schema labels are templated
// with the client's short company name — keying on the rendered English
// would miss them for every client. `{co}` is that same short name and is
// substituted at render time (see `si()`).
//
// Scope: the fixed base schema plus all form chrome. Claude's per-client
// extra questions (ids "extra_0"…) are generated in English and stay in
// English; the form says so quietly when Sinhala is on.
//
// Register: written the way Sri Lankan professionals actually write — the
// vocabulary the industry uses in English (website, logo, brand, quotation,
// email, WhatsApp, PDF, SEO, domain, hosting, design, Google) stays English
// rather than being replaced with coinages nobody says out loud.

export type SiText = { label?: string; hint?: string; placeholder?: string };

/** Every string outside the question schema, in one table per language.
 *  Declared rather than inferred so English and Sinhala can never drift out
 *  of sync — a missing key is a type error, not a silently English word. */
export type UIStrings = {
  langLabel: string;
  langNote: string;

  tagline: string;
  docTitle: string;
  pill: string;
  preparedFor: string;
  regNo: string;
  docNo: string;
  project: string;
  preparedBy: string;
  studio: string;

  howToTitle: string;
  howTo1: string;
  howTo2: string;

  other: string;
  attach: string;
  attachMore: string;
  uploading: (n: number) => string;
  fileNote: string;
  removeFile: (name: string) => string;

  copyLabel: string;
  copyTo: string;
  copyHint: string;

  submitNote: string;
  submit: string;
  sending: string;

  doneTitle: string;
  doneBody: string;
  doneBodyEnd: string;
  doneCopy1: string;
  doneCopy2: string;

  errName: string;
  errCopy: string;
  errGeneric: string;
  errSuffix: string;

  footNote: string;
};

/** Substitute the company short-name placeholder. */
export const si = (s: string, co: string): string => s.split("{co}").join(co);

export const SI_SECTIONS: Record<string, { eyebrow: string; title: string; sub?: string }> = {
  you: {
    eyebrow: "පටන් ගැනීමට පෙර",
    title: "මෙය පුරවන්නේ කවුද",
  },
  business: {
    eyebrow: "කොටස 01 · ඔබේ ව්‍යාපාරය",
    title: "ඔබ කවුද, ඔබ කරන්නේ කුමක්ද",
  },
  goals: {
    eyebrow: "කොටස 02 · ඉලක්ක සහ අපේක්ෂා",
    title: "මෙම ව්‍යාපෘතියෙන් ඉටු විය යුත්තේ කුමක්ද — සහ අපෙන් ඔබ අපේක්ෂා කරන්නේ කුමක්ද",
  },
  customers: {
    eyebrow: "කොටස 03 · ඔබේ පාරිභෝගිකයන්",
    title: "අප design කරන්නේ කා සඳහාද",
  },
  brand: {
    eyebrow: "කොටස 04 · Logo සහ brand ද්‍රව්‍ය",
    title: "ඔබ සතුව ඇති දේ — ගොනු මෙතැනින්ම attach කරන්න",
  },
  design: {
    eyebrow: "කොටස 05 · Design, වර්ණ සහ UI",
    title: "එය පෙනෙන්නට සහ දැනෙන්නට ඕන ආකාරය",
    sub: "Design එකට වැඩිම බලපෑමක් කරන කොටස මෙයයි — මෙහිදී ඔබ වඩාත් නිශ්චිත වන තරමට පළමු draft එක ඉලක්කයට ළං වේ.",
  },
  content: {
    eyebrow: "කොටස 06 · අන්තර්ගතය සහ පිටු කොටස්",
    title: "පිටුවේ තිබෙන්නේ කුමක්ද",
  },
  practical: {
    eyebrow: "කොටස 07 · ප්‍රායෝගික සහ තාක්ෂණික",
    title: "එළිදැක්වීම් නවත්වන දේවල්",
  },
  timeline: {
    eyebrow: "කොටස 08 · කාලසටහන සහ අනුමැතිය",
    title: "අපි එකට වැඩ කරන ආකාරය",
  },
};

export const SI_FIELDS: Record<string, SiText> = {
  // — you —
  contactName: { label: "ඔබේ නම" },
  contactRole: { label: "{co} හි ඔබේ තනතුර" },
  contactEmail: { label: "ඔබ සම්බන්ධ කරගත හැකි හොඳම email ලිපිනය" },
  contactPhone: { label: "හොඳම දුරකථන / WhatsApp අංකය" },

  // — business —
  describe: {
    label: "{co} වාක්‍ය 2–3කින් විස්තර කරන්න.",
    hint: "අලුත්ම පාරිභෝගිකයෙකුට පැහැදිලි කරන ආකාරයටම. මෙය බොහෝ විට website එකේ පළමු වාක්‍යය බවට පත් වේ.",
  },
  vision: {
    label: "ඔබේ දැක්ම (vision).",
    hint: "සමාගම යන දිශාව කුමක්ද — වසර 5–10කින් {co} කුමක් බවට පත් වීමට ඔබ කැමතිද?",
  },
  mission: {
    label: "ඔබේ මෙහෙවර (mission).",
    hint: "ඔබ දිනපතා කරන දේ සහ එය කරන්නේ ඇයි කියා. නිල vision / mission ප්‍රකාශ තිබේ නම්, ඒවා ඒ ලෙසම paste කරන්න.",
  },
  values: {
    label: "මූලික වටිනාකම් (core values).",
    hint: "සමාගම පිළිපදින වචන හෝ කෙටි වාක්‍ය ඛණ්ඩ 3–5ක්.",
  },
  tagline: { label: "Slogan හෝ tagline", hint: "දැනටමත් එකක් තිබේ නම් — නැතහොත් අප එකක් ලියනවාට කැමති නම්." },
  founded: {
    label: "ආරම්භ කළ වර්ෂය / ක්‍රියාත්මක වී ඇති කාලය",
    hint: "සඳහන් කිරීමට වටින සන්ධිස්ථාන ඇත්නම් ඒවාත් සමඟ.",
  },
  services: {
    label: "ඔබේ ප්‍රධාන සේවා හෝ නිෂ්පාදන, වැදගත්ම දේ මුලින්ම ලැයිස්තුගත කරන්න.",
    hint: "8ක් දක්වා. එකකට විස්තර පේළියක් තිබීම ඒවා නිවැරදිව ලිවීමට අපට උපකාරී වේ.",
  },
  different: {
    label: "තරඟකරුවන්ගෙන් ඔබව වෙනස් කරන්නේ කුමක්ද?",
    hint: "වේගය, සහතික, තමන්ගේම කණ්ඩායමක්, මිල, අලෙවියෙන් පසු සේවය — පාරිභෝගිකයන් ඇත්තටම ඔබව තෝරා ගන්නා හේතුව.",
  },
  areas: { label: "ඔබ සේවය කරන ප්‍රදේශ", placeholder: "උදා: දිවයින පුරා, කොළඹ සහ තදාසන්න ප්‍රදේශ, විදේශ" },
  stats: {
    label: "පෙන්වීමට වටිනා සංඛ්‍යා",
    hint: "සම්පූර්ණ කළ ව්‍යාපෘති, පාරිභෝගිකයන්, කණ්ඩායමේ ප්‍රමාණය, වසර — සංඛ්‍යා ඉක්මනින් විශ්වාසය ගොඩනඟයි.",
  },

  // — goals —
  job: { label: "මෙම ව්‍යාපෘතියේ අංක 1 කාර්යය… (ආසන්නම එක තෝරන්න)" },
  action: { label: "නරඹන්නෙකු ඒත්තු ගිය විට, ඔහු මුලින්ම කළ යුත්තේ කුමක්ද?" },
  lookingFor: {
    label: "ඔබ සොයන්නේ කුමක්ද — ඔබේම වචනවලින්?",
    hint: "Web තාක්ෂණික වචන අමතක කරන්න. එළිදැක්වීමෙන් පසු, අද සත්‍ය නොවන කුමක් සත්‍ය විය යුතුද?",
  },
  success: { label: "එළිදැක්වීමෙන් මාස 6කට පසු සාර්ථකත්වය පෙනෙන්නේ කෙසේද?" },
  expectations: {
    label: "හවුල්කරුවෙකු ලෙස Luminary ගෙන් ඔබ අපේක්ෂා කරන්නේ කුමක්ද?",
    hint: "සන්නිවේදන ශෛලිය, යාවත්කාලීන කිරීම්, විකල්ප ගැන අවංකකම — අප ඔබ සමඟ හොඳින් වැඩ කරන්නේ කෙසේදැයි කියන්න.",
  },
  mustHaves: {
    label: "අනිවාර්යයෙන්ම තිබිය යුතු දේ සහ කිසිසේත් පිළිගත නොහැකි දේ.",
    hint: "අනිවාර්යයෙන්ම ඇතුළත් විය යුතු ඕනෑම දෙයක්, සහ එක් වරම design එකක් ප්‍රතික්ෂේප කිරීමට ඔබව පොළඹවන ඕනෑම දෙයක්.",
  },

  // — customers —
  customer: {
    label: "ඔබේ සාමාන්‍ය පාරිභෝගිකයා කවුද?",
    hint: "කර්මාන්ත, සමාගම් වර්ග, සහ සාමාන්‍යයෙන් ඔබව සම්බන්ධ කර ගන්නා පුද්ගලයා.",
  },
  questions: {
    label: "ඔබව බඳවා ගැනීමට පෙර පාරිභෝගිකයන් සැමවිටම අසන ප්‍රධානම ප්‍රශ්න 3.",
    hint: "අපි ඒවාට කෙලින්ම පිටුවේම පිළිතුරු දෙමු — ඵලදායීම අන්තර්ගතය එයයි.",
  },
  matters: {
    label: "ඔබ වැනි ව්‍යාපාරයක් තෝරා ගැනීමේදී ඔවුන්ට වැදගත්ම වන්නේ කුමක්ද?",
    hint: "මිලද? සහතිකද? වේගයද? Warranty ද? නිර්දේශද? වැදගත්ම කිහිපය පිළිවෙළට සඳහන් කරන්න.",
  },
  objections: { label: "ඔබට මඟ හරවා ගැනීමට සිදු වන පොදු සැක හෝ විරෝධතා." },

  // — brand —
  logo: {
    label: "ඔබේ logo එක — අදාළ සියල්ල තෝරන්න:",
    hint: "ඔබ සතුව ඇති හොඳම ගොනු පහතින් attach කරන්න — letterhead එකක් හෝ business card scan එකක් වුවත් උදව්වක්.",
  },
  assets: { label: "වෙනත් brand ද්‍රව්‍ය — යැවිය හැකි සියල්ල තෝරන්න:" },
  brandFiles: {
    label: "ඔබේ brand ගොනු මෙතැනින් attach කරන්න.",
    hint: "Logo ගොනු, brand guidelines, brochure, letterhead, ඡායාරූප — රූප, PDF, Word, PowerPoint; ගොනුවකට 15 MB දක්වා ඕනෑම දෙයක්.",
  },
  certifications: { label: "Site එකේ පෙන්විය යුතු සහතික සහ ලියාපදිංචි කිරීම්." },
  clients: {
    label: "නම් සඳහන් කිරීමට හෝ පෙන්වීමට අවසර ඇති කැපී පෙනෙන පාරිභෝගිකයන් හෝ ව්‍යාපෘති.",
    hint: "ප්‍රසිද්ධ කිරීමට අවසර ඇති දේ පමණක්.",
  },

  // — design —
  inspirations: {
    label: "ආභාසය — ඔබ කැමති websites, ඕනෑම කර්මාන්තයකින්.",
    hint: "Link paste කරන්න, එකිනෙකට ඇයි කැමති දැයි වචන කිහිපයක් සමඟ. Screenshot ඊළඟ ප්‍රශ්නයට.",
    placeholder: "https://…  — මෙයට කැමති හේතුව",
  },
  inspirationFiles: {
    label: "ආභාසය ලැබූ screenshot attach කරන්න.",
    hint: "ඔබ කැමති site හෝ design වල screenshot — හැකි නම් ඒවාට සටහන් යොදන්න.",
  },
  dislikes: { label: "ඔබ කැමති නැති websites හෝ ශෛලීන්.", hint: "කැමති දේ තරම්ම ප්‍රයෝජනවත්." },
  feel: { label: "Site එක දැනිය යුත්තේ… (උපරිම 2ක් තෝරන්න)" },
  colourTheme: { label: "සමස්ත වර්ණ තේමාව:" },
  colours: { label: "භාවිතා කළ යුතු වර්ණ", hint: "දන්නවා නම් නිශ්චිත කේත, නැතිනම් නම් පමණක්." },
  coloursAvoid: { label: "වළක්වා ගත යුතු වර්ණ / ශෛලීන්" },
  typography: { label: "Typography දිශාව:" },
  imagery: { label: "රූප ශෛලිය:" },
  motion: { label: "චලනය සහ animation:" },
  features: {
    label: "ඔබට අවශ්‍ය UI විශේෂාංග — කැමති ඕනෑම එකක් තෝරන්න:",
    hint: "යමක් කුමක්දැයි විශ්වාස නැද්ද? එය හිස්ව තබන්න — නිවැරදි කට්ටලය අපි නිර්දේශ කරමු.",
  },
  dontWant: {
    label: "අනිවාර්යයෙන්ම ඔබට අවශ්‍ය නැති දේ.",
    placeholder: "උදා: pop-up, ස්වයංක්‍රීයව ධාවනය වන වීඩියෝ, අත් මිලාවන stock ඡායාරූප…",
  },

  // — content —
  sections: {
    label: "ඇතුළත් කළ යුතු කොටස් — අවශ්‍ය සියල්ල තෝරන්න:",
    hint: "Landing page එකක් හොඳින්ම ක්‍රියා කරන්නේ නාභිගත කොටස් 6–8කින් — අවසන් කට්ටලය ගැන අපි උපදෙස් දෙමු.",
  },
  copywriter: { label: "පෙළ ලියන්නේ කවුද?" },
  enquiryForm: { label: "විමසුම් form එක — එය අසිය යුත්තේ කුමක්ද, ලැබෙන පිළිතුරු යා යුත්තේ කොහෙද?" },
  existingContent: {
    label: "අපට යොදා ගත හැකි, දැනට ඇති අන්තර්ගතය.",
    hint: "පැරණි website එකක්, Facebook පිටුවක් — link මෙතැනට; ගොනු පහතින්.",
  },
  contentFiles: {
    label: "අන්තර්ගත ලේඛන ඇත්නම් attach කරන්න.",
    hint: "සමාගම් profile, මිල ලැයිස්තු, පෙළ draft — Word, PDF, spreadsheet.",
  },

  // — practical —
  domain: { label: "ඔබට domain නාමයක් තිබේද?", hint: "නැත්නම්, අපි ඔබ සමඟ එකක් ලියාපදිංචි කරමු." },
  hosting: {
    label: "දැනට website එකක් හෝ hosting තිබේද?",
    hint: "තිබේ නම් — අපි migration එක හසුරුවමු; නැත්නම් අලුතින්ම පටන් ගනිමු.",
  },
  publishContact: {
    label: "Site එකේ පළ කළ යුතු සම්බන්ධතා විස්තර.",
    hint: "දුරකථන අංක, email, ලිපිනය, ව්‍යාපාරික වේලාවන් — ප්‍රසිද්ධියේ පෙනිය යුතු ආකාරයටම.",
  },
  social: { label: "ඇතුළත් කළ යුතු social / profile link" },
  languages: { label: "අවශ්‍ය භාෂා", placeholder: "ඉංග්‍රීසි පමණද? සිංහල / දෙමළත් ද?" },
  seo: {
    label: "ඔබව සොයා ගැනීමට පාරිභෝගිකයන් Google එකේ type කරන්නේ කුමක්ද?",
    hint: "වාක්‍ය ඛණ්ඩ කිහිපයක්, සහ වැදගත් ස්ථාන — මෙය අප ගොඩනඟන SEO එකට මඟ පෙන්වයි.",
  },
  whatsapp: { label: "Chat බොත්තම සඳහා WhatsApp අංකය", hint: "ප්‍රධාන අංකයට වඩා වෙනස් නම්." },
  googleBusiness: {
    label: "Google Business profile එකක් තිබේද?",
    hint: "ඔව් / නැහැ / විශ්වාස නැහැ — නැත්නම් අපි එකක් හදමු.",
  },

  // — timeline —
  launch: {
    label: "ඉලක්කගත එළිදැක්වීමේ දිනය?",
    hint: "සහ එයට හේතුව — tender එකක්, ප්‍රදර්ශනයක්, campaign එකක්.",
  },
  approver: {
    label: "අවසන් අනුමැතිය දෙන්නේ කවුද?",
    hint: "එක් සම්බන්ධතා ලක්ෂ්‍යයක් තිබීම සංශෝධන වේගවත් කරයි.",
  },
  channel: { label: "සන්නිවේදනයට කැමතිම ක්‍රමය" },
  assetsWhen: {
    label: "ගොනු එවිය හැක්කේ කවදාද?",
    hint: "Logo, ඡායාරූප, ලේඛන — දිනයක් තිබීම කාලසටහන අවංකව තබා ගනී.",
  },
  anythingElse: { label: "අප දැනගත යුතු වෙනත් යමක්?" },
};

/** Checkbox options, keyed by their (static) English text. */
export const SI_OPTIONS: Record<string, string> = {
  // job
  "Generate enquiries & leads": "විමසීම් සහ නව පාරිභෝගිකයන් ලබා ගැනීම",
  "Look credible for tenders & proposals": "Tender සහ proposal සඳහා විශ්වාසනීය පෙනුමක් ලබා දීම",
  "Showcase our work": "අපේ වැඩ ප්‍රදර්ශනය කිරීම",
  // action
  Call: "අමතන්න",
  WhatsApp: "WhatsApp",
  Email: "Email",
  "Fill an enquiry form": "විමසුම් form එකක් පුරවන්න",
  // logo
  "We have a logo (attaching it below)": "අපට logo එකක් තිබේ (පහතින් attach කරමි)",
  "We have vector files (AI / SVG / EPS / PDF)": "අපට vector ගොනු තිබේ (AI / SVG / EPS / PDF)",
  "We only have images (PNG / JPG / from documents)": "අප සතුව ඇත්තේ රූප පමණි (PNG / JPG / ලේඛනවලින්)",
  "We have light & dark versions": "අපට light සහ dark අනුවාද දෙකම තිබේ",
  "We'd like the logo cleaned up / redrawn": "Logo එක පිරිසිදු කර / නැවත අඳිනවාට කැමතියි",
  "We don't have a logo — please design one": "අපට logo එකක් නැහැ — කරුණාකර එකක් design කරන්න",
  // assets
  "Brand guidelines / colour codes document": "Brand guidelines / වර්ණ කේත ලේඛනය",
  "Company profile / brochure (PDF)": "සමාගම් profile / brochure (PDF)",
  "Photos of projects or work": "ව්‍යාපෘති හෝ වැඩවල ඡායාරූප",
  "Photos of team / premises": "කණ්ඩායමේ / පරිශ්‍රයේ ඡායාරූප",
  "Letterheads, business cards, signage photos": "Letterhead, business card, නාම පුවරු ඡායාරූප",
  "Client testimonials or reviews": "පාරිභෝගික අදහස් හෝ සමාලෝචන",
  "Videos (site work, promos, walkthroughs)": "වීඩියෝ (වැඩබිම්, ප්‍රවර්ධන, walkthrough)",
  "Awards / certificates (scans)": "සම්මාන / සහතික (scan)",
  // feel
  "Corporate & precise": "Corporate සහ නිරවද්‍ය",
  "Modern & bold": "නවීන සහ නිර්භීත",
  "Warm & approachable": "සුහද සහ ළං විය හැකි",
  "Technical & detailed": "තාක්ෂණික සහ විස්තරාත්මක",
  "Premium & understated": "Premium සහ සංයමශීලී",
  // colourTheme
  "Light & clean": "Light සහ පිරිසිදු",
  "Dark & premium": "Dark සහ premium",
  "Follow our logo colours": "අපේ logo වර්ණ අනුගමනය කරන්න",
  "Designer's choice — surprise us": "Designer ගේ තේරීම — අපිව පුදුම කරන්න",
  // typography
  "Clean modern sans-serif": "පිරිසිදු නවීන sans-serif",
  "Classic serif touches": "සම්භාව්‍ය serif ස්පර්ශයන්",
  "Technical / engineered feel": "තාක්ෂණික / engineered හැඟීම",
  "Designer's choice": "Designer ගේ තේරීම",
  // imagery
  "Real photos of our work & team (preferred if available)":
    "අපේ වැඩ සහ කණ්ඩායමේ සැබෑ ඡායාරූප (තිබේ නම් වඩාත් සුදුසුයි)",
  "Professional stock photography": "වෘත්තීය stock ඡායාරූප",
  "Technical illustrations / diagrams": "තාක්ෂණික නිදර්ශන / රූප සටහන්",
  "Abstract / 3D graphics": "Abstract / 3D graphics",
  // motion
  "Subtle & professional (recommended)": "සියුම් සහ වෘත්තීය (නිර්දේශිතයි)",
  "Rich & eye-catching": "පොහොසත් සහ ඇස ගන්නා",
  "Minimal — almost none": "අවම — නැති තරම්",
  // features
  "Floating WhatsApp / call button": "පාවෙන WhatsApp / call බොත්තම",
  "Photo gallery / slider": "ඡායාරූප gallery / slider",
  "Animated stats counters": "Animation සහිත සංඛ්‍යා counter",
  "Client logo strip": "පාරිභෝගික logo පටිය",
  "Testimonials carousel": "පාරිභෝගික අදහස් carousel",
  "Google Map of our location": "අපේ ස්ථානයේ Google Map",
  "Dark / light mode toggle": "Dark / light mode toggle",
  "Video section": "වීඩියෝ කොටස",
  "FAQ accordion": "FAQ accordion",
  "Downloadable company profile (PDF)": "බාගත කළ හැකි සමාගම් profile (PDF)",
  // sections
  "Hero (headline + main action)": "Hero (ප්‍රධාන ශීර්ෂය + ප්‍රධාන ක්‍රියාව)",
  "About us / who we are": "අප ගැන / අපි කවුද",
  "Vision & mission": "දැක්ම සහ මෙහෙවර",
  "Services / products": "සේවා / නිෂ්පාදන",
  "Completed projects / portfolio": "සම්පූර්ණ කළ ව්‍යාපෘති / portfolio",
  "Certifications & registrations": "සහතික සහ ලියාපදිංචි කිරීම්",
  "Clients & partners": "පාරිභෝගිකයන් සහ හවුල්කරුවන්",
  Testimonials: "පාරිභෝගික අදහස්",
  "Our team": "අපේ කණ්ඩායම",
  "Process — how we work": "ක්‍රියාවලිය — අපි වැඩ කරන ආකාරය",
  FAQ: "නිතර අසන ප්‍රශ්න (FAQ)",
  "Contact & enquiry form": "සම්බන්ධ වීම සහ විමසුම් form",
  // copywriter
  "We'll send our own text": "අපේම පෙළ අපි එවනවා",
  "Luminary writes it from this form (recommended)": "මෙම form එකෙන් Luminary ලියයි (නිර්දේශිතයි)",
  "Mix — we'll send notes, you polish": "මිශ්‍රයක් — අපි සටහන් එවනවා, ඔබ ඔප දමන්න",
  // channel
  Calls: "දුරකථන ඇමතුම්",
};

/** Everything around the questions: page head, intro, upload control,
 *  copy block, submit bar, thank-you screen and error text. */
export const SI_UI: UIStrings = {
  langLabel: "භාෂාව",
  langNote:
    "ඔබේ ව්‍යාපෘතියට ආවේණික අමතර ප්‍රශ්න කිහිපයක් ඉංග්‍රීසියෙන් පවතී — ඒවාට සිංහලෙන් පිළිතුරු දුන්නත් කිසිම ගැටලුවක් නැහැ.",

  tagline: "Full-Service Digital Studio",
  docTitle: "ප්‍රශ්නාවලිය",
  pill: "ව්‍යාපෘති තොරතුරු රැස්කිරීම",
  preparedFor: "සකස් කර ඇත්තේ",
  regNo: "ලියාපදිංචි අංකය",
  docNo: "ලේඛන අංකය",
  project: "ව්‍යාපෘතිය",
  preparedBy: "සකස් කළේ",
  studio: "Luminary Studio",

  howToTitle: "මෙය ක්‍රියාත්මක වන ආකාරය:",
  howTo1:
    "පහත ප්‍රශ්නවලට පිළිතුරු දී Submit එබන්න — ඔබේ පිළිතුරු කෙලින්ම අපේ studio එකට එයි; print කිරීමක් හෝ email කිරීමක් අවශ්‍ය නැහැ. Logo, ඡායාරූප, screenshot සහ ලේඛන, Attach files බොත්තම දකින සෑම තැනකින්ම කෙලින්ම මෙම form එකට එකතු කළ හැකියි. මෙම form එක හිතාමතාම විස්තරාත්මකයි: එක් එක් පිළිතුර පසුව සංශෝධන වාරයක් ඉතිරි කරයි. විශ්වාස නැති ඕනෑම දෙයක් හිස්ව තබන්න — kickoff call එකේදී අපි ඒවා ආවරණය කරමු.",
  howTo2: "විනාඩි 25–30ක් ගත වේ — ඒ හැම විනාඩියක්ම වටිනවා.",

  other: "වෙනත්:",
  attach: "+ ගොනු attach කරන්න",
  attachMore: "+ තව ගොනු attach කරන්න",
  uploading: (n: number) => `ගොනු ${n}ක් upload වෙමින්…`,
  fileNote: "ඕනෑම ගොනු වර්ගයක් · එකකට 15 MB දක්වා",
  removeFile: (name: string) => `${name} ඉවත් කරන්න`,

  copyLabel: "මගේ පිළිතුරුවල පිටපතක් (PDF) මට / මගේ කණ්ඩායමට email කරන්න",
  copyTo: "පිටපත යවන්නේ",
  copyHint: "email ලිපින එකක් හෝ කිහිපයක්, කොමා වලින් වෙන් කර.",

  submitNote:
    "Submit එබූ විට ඔබේ පිළිතුරු PDF එකක් ලෙස කෙලින්ම Luminary Studio වෙත යවනු ලැබේ. කිසිවක් කොහේවත් ප්‍රසිද්ධ නොකෙරේ.",
  submit: "ප්‍රශ්නාවලිය යොමු කරන්න",
  sending: "යවමින්…",

  doneTitle: "ස්තුතියි — අපට ලැබුණා.",
  doneBody:
    "ඔබේ පිළිතුරු — සහ ඔබ attach කළ සෑම ගොනුවක්ම — PDF එකක් ලෙස studio එකට ලැබී තිබේ. ඒවා සමාලෝචනය කර, එක් ව්‍යාපාරික දිනයක් ඇතුළත තහවුරු කළ scope එක සහ ස්ථිර quotation එක සමඟ අපි ඔබ වෙත එමු. Attach කිරීමට අමතක වූ ඕනෑම දෙයක් ඕනෑම වේලාවක ",
  doneBodyEnd: " වෙත email කරන්න.",
  doneCopy1: "ඔබේ පිළිතුරුවල පිටපතක් ",
  doneCopy2: " වෙත යමින් පවතී — inbox එක (සහ පළමු වතාවේ spam එකත්) බලන්න.",

  errName: "කරුණාකර ඔබේ නම (පළමු ප්‍රශ්නය) සඳහන් කරන්න — පිළිතුරු දිය යුත්තේ කාටදැයි අපි දැනගන්නට.",
  errCopy: "ඔබ පිටපතක් ඉල්ලා ඇත — කරුණාකර ඒ සඳහා වලංගු email ලිපිනයක් වත් ඇතුළත් කරන්න.",
  errGeneric: "යම් වරදක් සිදු විය.",
  errSuffix:
    " ඔබේ පිළිතුරු තවමත් මෙහි ඇත — කරුණාකර නැවත උත්සාහ කරන්න, නැතහොත් support@luminary-dev.xyz වෙත email කරන්න.",

  footNote:
    "ඔබේ පිළිතුරු පෞද්ගලිකව Luminary Studio වෙත යවනු ලබන අතර, ඒවා භාවිතා කරන්නේ ඔබේ ව්‍යාපෘතිය scope කර design කිරීමට පමණි.",
};
