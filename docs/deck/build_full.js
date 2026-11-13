// Waterline datathon deck. Run: node build.js
const path = require('path');
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(path.join(process.env.SKILL_DIR, 'scripts/apply_theme.js'));

const IMG = path.join(__dirname, 'img');
const OUT = process.argv[2] || path.join(__dirname, '..', 'Waterline_Full_Backup.pptx');

// Palette from the app: forest green (dominant), flood-water brown accent
const THEME = {
  name: 'Waterline',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '111815', lt1: 'FFFFFF', dk2: '1B4D34', lt2: 'EEF3F0',
    accent1: '7C3A0E', accent2: 'B45309', accent3: '52675B', accent4: '9AB0A2', accent5: 'B91C1C', accent6: '2D3A33',
    hlink: '1B4D34', folHlink: '52675B',
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Waterline';
pres.subject = 'UTSA Datathon 2026';
const C = pres.SchemeColor;

// ---------------------------------------------------------------- layouts
pres.defineSlideMaster({
  title: 'DARK',
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 2.2, w: 6.6, h: 1.6, fontFace: 'Cambria', fontSize: 60, bold: true, color: C.background1, valign: 'bottom', align: 'left', margin: 0 }, text: 'Title' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 3.95, w: 6.4, h: 2.0, fontSize: 20, color: C.background2, valign: 'top', align: 'left', margin: 0 }, text: 'Subtitle' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: C.background1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 36, bold: true, color: C.text1, valign: 'middle', align: 'left', margin: 0 }, text: 'Title' } },
    { text: { text: 'Waterline · UTSA Datathon 2026', options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: C.accent3, margin: 0 } } },
  ],
  slideNumber: { x: 12.3, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.accent3, align: 'right' },
});

let shapeId = 0;
const nm = n => `${n}-${++shapeId}`;
const text = (slide, t, o) => slide.addText(t, { isTextBox: true, margin: 0, fontFace: 'Calibri', color: C.text1, objectName: nm('text'), ...o });
const card = (slide, x, y, w, h, fill = C.background2) =>
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill }, objectName: nm('card') });
const dot = (slide, x, y, label, fill = C.text2) => {
  slide.addShape(pres.shapes.OVAL, { x, y, w: 0.5, h: 0.5, fill: { color: fill }, line: { color: fill }, objectName: nm('dot') });
  text(slide, label, { x, y, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: 'center', valign: 'middle' });
};
const arrow = (slide, x, y, w, h, flipV = false) =>
  slide.addShape(pres.shapes.LINE, { x, y, w, h, flipV, line: { color: C.accent3, width: 1.5, endArrowType: 'triangle' }, objectName: nm('arrow') });

// ================================================================ 1. title
pres.addSection({ title: 'Why' });
let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Why' });
s.addText('Waterline', { placeholder: 'title' });
s.addText(
  [
    { text: 'See how fast the water rises', options: { fontSize: 26, bold: true, breakLine: true } },
    { text: ' ', options: { fontSize: 10, breakLine: true } },
    { text: 'An AR flood replay app built on real Texas flood data and two trained models', options: { fontSize: 18 } },
  ],
  { placeholder: 'body' }
);
s.addImage({ path: path.join(IMG, 'hunt_after.jpg'), x: 7.9, y: 0, w: 5.43, h: 7.5, sizing: { type: 'cover', w: 5.43, h: 7.5 }, altText: 'NOAA aerial photo of the Guadalupe River at Hunt, Texas, after the July 4 2025 flood', objectName: 'hero-photo' });
text(s, 'Guadalupe River at Hunt, a week after July 4 2025 · NOAA via UTSA dataset', { x: 8.1, y: 7.0, w: 5.0, h: 0.3, fontSize: 10, color: C.background1 });
s.addNotes('Waterline lets you watch a real flood rise around you, hour by hour, so the speed of a flash flood stops being abstract. Everything in it comes from real Texas data and two models we trained this weekend.');

// ================================================================ 2. problem
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Why' });
s.addText('Floods move faster than people expect', { placeholder: 'title' });
const stats = [
  ['30 ft', 'River rise at Hunt in about 3 hours on July 4 2025, before the gauge was destroyed'],
  ['7 min', 'At Kerrville, from dry ground to over an adult’s head, for a spot 20 ft above the river'],
  ['1 ft', 'Of moving water can float most cars. Many flood deaths happen in vehicles'],
];
stats.forEach(([big, small], i) => {
  const x = 0.6 + i * 4.1;
  card(s, x, 1.7, 3.8, 3.9);
  text(s, big, { x: x + 0.35, y: 2.0, w: 3.1, h: 1.4, fontFace: 'Cambria', fontSize: 66, bold: true, color: i === 2 ? C.accent1 : C.text2 });
  text(s, small, { x: x + 0.35, y: 3.5, w: 3.1, h: 1.8, fontSize: 18, color: C.text1, valign: 'top' });
});
text(s, 'Sources: USGS gauges 08165500 (Hunt) and 08166200 (Kerrville), 15-minute readings; National Weather Service “Turn Around, Don’t Drown”.', { x: 0.6, y: 6.0, w: 12.1, h: 0.4, fontSize: 12, color: C.accent3 });
s.addNotes('People think of a flood as "a lot of water". The real danger is the speed: at Hunt the river rose about 30 feet in roughly three hours overnight. At Kerrville, a spot 20 feet above the normal river went from dry to over your head in seven minutes.');

// ================================================================ 3. the app
pres.addSection({ title: 'What we built' });
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'What we built' });
s.addText('Waterline puts that speed in front of you', { placeholder: 'title' });
s.addImage({ path: path.join(IMG, 'side_view.jpg'), x: 0.6, y: 1.6, w: 4.9, h: 4.9, altText: 'App side view: an adult and a car with water rising past the knees', objectName: 'side-view' });
text(s, 'Side view in the app: 5 ft 8 in adult and a sedan, true to scale', { x: 0.6, y: 6.55, w: 4.9, h: 0.3, fontSize: 11, color: C.accent3 });
const feats = [
  ['1', 'Rise: AR flood replay', 'Point your camera at a wall or car. Water from a real flood rises on it hour by hour, with depth markers, haptics and the model’s forecast. Your GPS sets how high your ground is.'],
  ['2', 'Compare & Explore', 'All 575 before/after aerial pairs from the UTSA dataset, with floodwater heatmaps and a flood-likelihood score. Clearest floods first.'],
  ['3', 'Label photos', 'A one-question screen that let two of us label 150 photos, which trained the photo model.'],
];
feats.forEach(([n, h, b], i) => {
  const y = 1.7 + i * 1.65;
  dot(s, 6.0, y, n);
  text(s, h, { x: 6.7, y: y - 0.05, w: 6.0, h: 0.45, fontFace: 'Cambria', fontSize: 22, bold: true, color: C.text2 });
  text(s, b, { x: 6.7, y: y + 0.45, w: 6.0, h: 1.05, fontSize: 16, valign: 'top' });
});
s.addNotes('Three parts. Rise is the experience: a real flood replayed on the wall in front of you. Compare and Explore are the evidence: real before and after photos with heatmaps. Label is how we got training data.');

// ================================================================ 4. impact
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'What we built' });
s.addText('Social impact: show how severe flash floods are', { placeholder: 'title' });
const impact = [
  ['Feel the speed', 'Ankle-deep to over your head in minutes, from a real Texas gauge, replayed where you stand.'],
  ['Make it local', 'Real USGS gauges and real aerial photos of Texas floods, not a generic animation.'],
  ['Reach who underestimates it', 'Hill Country river corridors and camps, low-water-crossing commuters, students new to Texas.'],
  ['Accessible and honest', 'Screen-reader labels, haptics and a no-camera view; clearly a replay of past floods, not a forecast.'],
];
impact.forEach(([h, b], i) => {
  const x = 0.6 + (i % 2) * 6.15;
  const y = 1.6 + Math.floor(i / 2) * 2.25;
  card(s, x, y, 5.95, 2.05);
  text(s, h, { x: x + 0.35, y: y + 0.3, w: 5.3, h: 0.45, fontFace: 'Cambria', fontSize: 22, bold: true, color: C.text2 });
  text(s, b, { x: x + 0.35, y: y + 0.85, w: 5.3, h: 1.05, fontSize: 16, valign: 'top' });
});
text(s, [{ text: 'Goal: ', options: { bold: true, color: C.accent1 } }, { text: 'people understand how fast and deep a flash flood gets, and take warnings seriously.' }], { x: 0.6, y: 6.2, w: 12.1, h: 0.45, fontSize: 18 });
s.addNotes('Our aim is awareness of how severe flash floods are. We are not claiming measured outcomes yet; a pilot with a county emergency office or a school could test whether people rate flash floods as more dangerous after using it.');

// ================================================================ 5. diagram
pres.addSection({ title: 'How it works' });
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'How it works' });
s.addText('How it fits together', { placeholder: 'title' });
const col = (t, x) => text(s, t, { x, y: 1.35, w: 3, h: 0.3, fontSize: 12, bold: true, color: C.accent3, charSpacing: 2 });
col('DATASETS', 0.6); col('MODELS', 4.65); col('APP', 9.75);
const box = (x, y, w, h, title, sub, fill = C.background1, line = C.accent4, titleColor = C.text1) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: line, width: 1 }, objectName: nm('box') });
  text(s, title, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.32, fontSize: 14, bold: true, color: titleColor });
  if (sub) text(s, sub, { x: x + 0.15, y: y + 0.42, w: w - 0.3, h: h - 0.5, fontSize: 11, color: C.accent6, valign: 'top' });
};
// datasets
box(0.6, 1.75, 3.1, 1.05, 'UTSA flood images', '1,204 aerial photos · 575 before/after pairs · Hugging Face');
box(0.6, 2.95, 3.1, 0.95, 'Team labels', '150 photos × 2 people · 92% agreement');
box(0.6, 4.45, 3.1, 0.95, 'USGS river gauges', '18 gauges near the photos · 15-min, 2014–2025');
box(0.6, 5.55, 3.1, 0.95, 'Open-Meteo rainfall', 'hourly ERA5 rain at each gauge');
// models
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.65, y: 1.7, w: 4.3, h: 2.35, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.text2, width: 1.25 }, objectName: 'group-photo' });
text(s, 'Photo models', { x: 4.85, y: 1.78, w: 3.9, h: 0.3, fontSize: 13, bold: true, color: C.text2 });
box(4.85, 2.12, 3.9, 0.55, 'Change model · Colab L4 GPU', null);
box(4.85, 2.75, 3.9, 0.55, 'Floodwater colour rule', null);
box(4.85, 3.38, 3.9, 0.55, 'Flood photo classifier · AUC 0.86', null);
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.65, y: 4.35, w: 4.3, h: 2.15, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.text2, width: 1.25 }, objectName: 'group-qwen' });
text(s, 'USAA Datathon Qwen server', { x: 4.85, y: 4.43, w: 3.9, h: 0.3, fontSize: 13, bold: true, color: C.text2 });
box(4.85, 4.8, 3.9, 0.8, 'River-level forecaster', 'LightGBM · rise 1–12 h ahead');
box(4.85, 5.7, 3.9, 0.6, 'Qwen LLM · debugged the training', null, 'FBF0E2', C.accent1, C.accent1);
// app
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.75, y: 1.7, w: 2.95, h: 4.8, rectRadius: 0.25, fill: { color: C.background1 }, line: { color: C.text1, width: 1.5 }, objectName: 'phone' });
text(s, 'Phone app · Expo Go', { x: 9.95, y: 1.85, w: 2.6, h: 0.3, fontSize: 13, bold: true });
box(9.95, 2.3, 2.55, 1.55, 'Compare & Explore', 'before/after photos, floodwater heatmaps, “94% likely flooded”');
box(9.95, 4.4, 2.55, 1.6, 'Rise', 'AR flood replay at your spot, with the forecast');
// arrows
arrow(s, 3.7, 2.27, 1.15, 0.13);
arrow(s, 3.7, 3.42, 1.15, 0.235);
arrow(s, 3.7, 4.92, 1.15, 0.28);
arrow(s, 3.7, 5.2, 1.15, 0.82, true);
arrow(s, 8.75, 3.05, 1.2, 0);
arrow(s, 8.75, 5.2, 1.2, 0);
text(s, 'heatmaps', { x: 8.8, y: 2.72, w: 1.1, h: 0.28, fontSize: 11, color: C.accent3, align: 'center' });
text(s, 'forecasts', { x: 8.8, y: 4.87, w: 1.1, h: 0.28, fontSize: 11, color: C.accent3, align: 'center' });
s.addNotes('Left to right: four datasets, four models, two app screens. The photos also decided which river gauges we trained on: we used the 18 gauges the UTSA metadata links to the photos.');

// ================================================================ 6. datasets
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'How it works' });
s.addText('Four datasets, all public or ours', { placeholder: 'title' });
const ds = [
  ['575', 'before/after pairs', 'UTSA flood images (Hugging Face, jennifer-fowler/UTSA-flood-images): 1,204 NOAA and USDA aerial photos from Harvey 2017 and the 2025 Hill Country flood, 273 metadata columns'],
  ['18', 'river gauges', 'USGS Water Data API: 15-minute river levels, 2014–2025, at the gauges the photo metadata links to'],
  ['12 yrs', 'of hourly rain', 'Open-Meteo historical archive (ERA5) at each gauge, for the forecaster’s rain features'],
  ['300', 'team labels', '150 photos labelled “flooded or not” by two of us; we agreed on 92% (κ 0.62)'],
];
ds.forEach(([big, unit, b], i) => {
  const x = 0.6 + i * 3.08;
  card(s, x, 1.7, 2.88, 4.6);
  text(s, big, { x: x + 0.3, y: 1.95, w: 2.4, h: 0.95, fontFace: 'Cambria', fontSize: 44, bold: true, color: C.text2 });
  text(s, unit, { x: x + 0.3, y: 2.9, w: 2.4, h: 0.35, fontSize: 16, bold: true, color: C.accent1 });
  text(s, b, { x: x + 0.3, y: 3.4, w: 2.35, h: 2.75, fontSize: 14, valign: 'top' });
});
s.addNotes('The UTSA images are the core dataset. Their metadata linked each photo to a USGS gauge, which is how we chose rivers for the forecaster. The labels are ours.');

// ================================================================ 7. forecaster
pres.addSection({ title: 'Models' });
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Models' });
s.addText('Model 1: how fast will the river rise?', { placeholder: 'title' });
// Grouped bars drawn from shapes (renders identically in PowerPoint, Keynote and Google Slides)
text(s, 'Average error on floods it never saw (ft, lower is better)', { x: 0.6, y: 1.55, w: 7.2, h: 0.35, fontSize: 15, bold: true });
{
  const base = 5.9, top = 2.3, maxV = 1.3, scale = (base - top) / maxV;
  const groups = [['1 h ahead', 0.32, 0.36], ['3 h ahead', 0.71, 0.77], ['6 h ahead', 1.03, 1.13]];
  [0, 0.5, 1.0].forEach(v => {
    const y = base - v * scale;
    s.addShape(pres.shapes.LINE, { x: 1.1, y, w: 6.6, h: 0, line: { color: 'DDE5E0', width: 0.75 }, objectName: nm('grid') });
    text(s, v.toFixed(1), { x: 0.6, y: y - 0.14, w: 0.4, h: 0.28, fontSize: 11, color: C.accent3, align: 'right' });
  });
  groups.forEach(([label, ours, baseline], g) => {
    const gx = 1.45 + g * 2.15;
    [[ours, C.text2], [baseline, C.accent4]].forEach(([v, color], k) => {
      const h = v * scale;
      const x = gx + k * 0.75;
      s.addShape(pres.shapes.RECTANGLE, { x, y: base - h, w: 0.65, h, fill: { color }, line: { color }, objectName: nm('bar') });
      text(s, v.toFixed(2), { x: x - 0.1, y: base - h - 0.32, w: 0.85, h: 0.28, fontSize: 12, bold: k === 0, align: 'center' });
    });
    text(s, label, { x: gx - 0.2, y: base + 0.08, w: 1.8, h: 0.3, fontSize: 13, align: 'center', color: C.accent6 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 1.45, y: 6.48, w: 0.22, h: 0.22, fill: { color: C.text2 }, line: { color: C.text2 }, objectName: 'key-ours' });
  text(s, 'Our forecaster (LightGBM)', { x: 1.75, y: 6.45, w: 2.6, h: 0.28, fontSize: 12 });
  s.addShape(pres.shapes.RECTANGLE, { x: 4.4, y: 6.48, w: 0.22, h: 0.22, fill: { color: C.accent4 }, line: { color: C.accent4 }, objectName: 'key-base' });
  text(s, 'Baseline: the river stays the same', { x: 4.7, y: 6.45, w: 3.0, h: 0.28, fontSize: 12 });
}
const fc = [
  ['Question', 'Given the last 3 days of river level and rain, how many feet will the river rise in the next 1–12 hours?'],
  ['Data', '590,000 training hours from 18 gauges; Hurricane Harvey and the 2025 Hill Country flood held out entirely'],
  ['Result', 'Beats the baseline at every lead time, and is 24% more accurate while rivers are rising (2023+ test years)'],
];
fc.forEach(([h, b], i) => {
  const y = 1.7 + i * 1.6;
  text(s, h, { x: 8.3, y, w: 4.4, h: 0.35, fontFace: 'Cambria', fontSize: 18, bold: true, color: C.text2 });
  text(s, b, { x: 8.3, y: y + 0.4, w: 4.4, h: 1.1, fontSize: 15, valign: 'top' });
});
s.addNotes('Trained on the Qwen server. The app replays the held-out floods with the model’s 1, 3 and 6 hour forecasts. Honest weak spot: it under-predicts sudden surges, see the limits slide.');

// ================================================================ 8. photo model
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Models' });
s.addText('Model 2: which photos show flooding?', { placeholder: 'title' });
s.addImage({ path: path.join(IMG, 'pair_before.jpg'), x: 0.6, y: 1.6, w: 2.45, h: 2.45, altText: '2016 USDA aerial photo: green field', objectName: 'pair-before' });
s.addImage({ path: path.join(IMG, 'pair_after.jpg'), x: 3.2, y: 1.6, w: 2.45, h: 2.45, altText: '2017 NOAA aerial photo after Harvey: the same field under brown floodwater', objectName: 'pair-after' });
text(s, 'Before (2016)', { x: 0.6, y: 4.1, w: 2.45, h: 0.3, fontSize: 12, color: C.accent3 });
text(s, 'After Harvey (2017)', { x: 3.2, y: 4.1, w: 2.45, h: 0.3, fontSize: 12, color: C.accent3 });
text(s, 'The app’s top-ranked example: 100% likely flooded', { x: 0.6, y: 4.5, w: 5.05, h: 0.35, fontSize: 14, bold: true, color: C.text2 });
text(s, 'A self-supervised change model (no labels) learned to ignore camera differences but not to find water. A simple floodwater-colour rule did better, and a classifier trained on our 138 agreed labels combined both.', { x: 0.6, y: 4.95, w: 5.05, h: 1.6, fontSize: 14, valign: 'top' });
text(s, 'How often a flooded photo ranks above a dry one (AUC, on team labels)', { x: 6.1, y: 1.55, w: 6.6, h: 0.35, fontSize: 15, bold: true });
{
  const rows = [
    ['Flood photo classifier', 0.86, C.text2],
    ['Floodwater colour rule', 0.81, C.accent2],
    ['Change model (Colab)', 0.47, C.accent4],
    ['Coin flip', 0.5, 'C9D3CD'],
  ];
  const x0 = 8.75, wMax = 3.4;
  rows.forEach(([label, v, color], i) => {
    const y = 2.25 + i * 1.0;
    text(s, label, { x: 6.1, y: y + 0.08, w: 2.55, h: 0.45, fontSize: 14, align: 'right', color: C.accent6 });
    s.addShape(pres.shapes.RECTANGLE, { x: x0, y, w: v * wMax, h: 0.6, fill: { color }, line: { color }, objectName: nm('auc') });
    text(s, v.toFixed(2), { x: x0 + Math.max(v, 0.53) * wMax + 0.1, y: y + 0.12, w: 0.6, h: 0.36, fontSize: 14, bold: i === 0 });
  });
  s.addShape(pres.shapes.LINE, { x: x0 + 0.5 * wMax, y: 2.15, w: 0, h: 3.95, line: { color: C.accent3, width: 1, dashType: 'dash' }, objectName: 'chance-line' });
  text(s, 'chance', { x: x0 + 0.5 * wMax - 0.4, y: 6.12, w: 0.8, h: 0.25, fontSize: 11, color: C.accent3, align: 'center' });
  text(s, 'Classifier likely range 0.80–0.92 · balanced accuracy 0.86 · tested on areas it never trained on', { x: 6.1, y: 6.45, w: 6.6, h: 0.3, fontSize: 12, color: C.accent3 });
}
s.addNotes('Cross-validated by area, so test photos come from places the model never trained on. Classifier AUC 0.86, likely range 0.80 to 0.92; balanced accuracy 0.86. Only 12 dry photos, so the range is wide.');

// ================================================================ 9. LLMs
pres.addSection({ title: 'AI use' });
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'AI use' });
s.addText('How we used LLMs', { placeholder: 'title' });
const llm = [
  ['Q', 'Qwen 3.8 27B · USAA Datathon Qwen server', 'Debugged the river forecaster’s training code, running on the same machine that trained the model.', C.accent1],
  ['✓', 'What LLMs did not do', 'No number in the app comes from an LLM. Forecasts, heatmaps and flood scores come from the trained models; the training labels came from two team members.', C.text2],
];
llm.forEach(([g, h, b, fill], i) => {
  const y = 1.75 + i * 1.6;
  card(s, 0.6, y - 0.15, 12.1, 1.4);
  dot(s, 0.9, y + 0.2, g, fill);
  text(s, h, { x: 1.7, y: y, w: 10.7, h: 0.4, fontFace: 'Cambria', fontSize: 20, bold: true, color: C.text2 });
  text(s, b, { x: 1.7, y: y + 0.45, w: 10.7, h: 0.7, fontSize: 16, valign: 'top' });
});
s.addNotes('LLMs sped up the work around the models. The models themselves are classic ML we trained and evaluated against baselines.');

// ================================================================ 10. limits
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'AI use' });
s.addText('Limits we’re upfront about', { placeholder: 'title' });
const limits = [
  ['An illustration, not a forecast for your address', 'Rise replays past floods; your GPS height is measured against the lowest ground within 1 km.'],
  ['Sudden surges are the hardest part', 'At Kerrville the 3-hour forecast missed the 6 AM surge (about 3 ft predicted, 26 ft observed).'],
  ['Colour-based photo scores miss grey water', 'Floodwater that looks grey or dark in haze ranks low; more labels of those photos would fix it.'],
  ['Expo Go has no LiDAR', 'The camera tracks tilting and turning; after walking you re-aim at a new spot.'],
];
limits.forEach(([h, b], i) => {
  const y = 1.65 + i * 1.25;
  dot(s, 0.6, y + 0.05, String(i + 1), C.accent3);
  text(s, h, { x: 1.35, y, w: 11.3, h: 0.4, fontFace: 'Cambria', fontSize: 20, bold: true, color: C.text1 });
  text(s, b, { x: 1.35, y: y + 0.42, w: 11.3, h: 0.6, fontSize: 16, color: C.accent6, valign: 'top' });
});
s.addNotes('We would rather show these than have a judge find them.');

// ================================================================ 11. next + close
pres.addSection({ title: 'Next' });
s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Next' });
s.addText('What’s next', { placeholder: 'title' });
s.addText('Turn around, don’t drown.', { placeholder: 'body' });
const next = [
  'Live forecasts from the Qwen server in the app',
  'A flood map of all 575 locations and 18 gauges',
  'Label grey-water photos and retrain',
  'Spanish, and a pilot with a county emergency office',
];
next.forEach((t, i) => {
  const y = 1.0 + i * 1.45;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.7, y, w: 5.0, h: 1.2, rectRadius: 0.12, fill: { color: '245C40' }, line: { color: '245C40' }, objectName: nm('next') });
  text(s, String(i + 1), { x: 7.95, y, w: 0.5, h: 1.2, fontFace: 'Cambria', fontSize: 30, bold: true, color: C.accent4, valign: 'middle' });
  text(s, t, { x: 8.55, y, w: 3.95, h: 1.2, fontSize: 18, color: C.background1, valign: 'middle' });
});
s.addNotes('Next steps, then thanks. Demo: Hunt replay in the side view, then the AR camera, then Compare’s top example.');

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
})();
