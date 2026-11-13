// Waterline datathon deck. Run: node build.js
const path = require('path');
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(path.join(process.env.SKILL_DIR, 'scripts/apply_theme.js'));

const IMG = path.join(__dirname, 'img');
const OUT = process.argv[2] || path.join(__dirname, '..', 'Waterline_Demo.pptx');

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


// ================================================================ 1. hook
pres.addSection({ title: 'Waterline' });
let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Waterline' });
s.addText('Waterline', { placeholder: 'title' });
s.addText(
  [
    { text: 'See how fast the water rises', options: { fontSize: 26, bold: true, breakLine: true } },
    { text: ' ', options: { fontSize: 10, breakLine: true } },
    { text: 'July 4 2025, Kerrville: a spot 20 ft above the Guadalupe River went from dry ground to over an adult’s head in 7 minutes.', options: { fontSize: 20 } },
  ],
  { placeholder: 'body' }
);
s.addImage({ path: path.join(IMG, 'hunt_after.jpg'), x: 7.9, y: 0, w: 5.43, h: 7.5, sizing: { type: 'cover', w: 5.43, h: 7.5 }, altText: 'NOAA aerial photo of the Guadalupe River at Hunt, Texas, after the July 4 2025 flood', objectName: 'hero-photo' });
text(s, 'Guadalupe River at Hunt, a week after July 4 2025 · NOAA via UTSA dataset', { x: 8.1, y: 7.0, w: 5.0, h: 0.3, fontSize: 10, color: C.background1 });
s.addNotes('[0:00–0:30] People picture a flood as “a lot of water”. The danger is speed. On July 4 2025 at Kerrville, a spot 20 feet above the river went from dry to over your head in seven minutes (USGS gauge readings). Waterline lets you watch a real flood like that rise where you stand.');

// ================================================================ 2. demo
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Waterline' });
s.addText('Demo: a real flood, replayed where you stand', { placeholder: 'title' });
s.addImage({ path: path.join(IMG, 'side_view.jpg'), x: 0.6, y: 1.6, w: 4.9, h: 4.9, altText: 'App side view: an adult and a car with water rising past the knees', objectName: 'side-view' });
text(s, 'Side view in the app, true to scale', { x: 0.6, y: 6.55, w: 4.9, h: 0.3, fontSize: 11, color: C.accent3 });
const steps = [
  ['Play the Hunt flood', 'River levels from the real USGS gauge, every 15 minutes. Watch the clock and the depth.'],
  ['Use my location', 'USGS lidar elevation sets how high your ground is, so the depth is for where you stand.'],
  ['Camera: place the water', 'Aim at the base of a wall, tap Place here, and the flood rises on it as you tilt and turn.'],
  ['Compare', 'The clearest flood photo out of 575 before/after pairs, with its floodwater heatmap.'],
];
steps.forEach(([h, b], i) => {
  const y = 1.65 + i * 1.22;
  dot(s, 6.0, y, String(i + 1));
  text(s, h, { x: 6.7, y: y - 0.05, w: 6.0, h: 0.42, fontFace: 'Cambria', fontSize: 20, bold: true, color: C.text2 });
  text(s, b, { x: 6.7, y: y + 0.4, w: 6.0, h: 0.7, fontSize: 15, valign: 'top' });
});
s.addNotes('[0:30–2:30] LIVE DEMO on the phone. (1) Rise: pick Guadalupe River at Hunt, press Play; point out the clock and how fast the depth goes from dry to over the man’s head. (2) Tap “Use my location”; depth now reflects our real height above nearby low ground. (3) Tap Camera, aim at the base of the wall, Place here; play again and tilt and turn. (4) Compare tab: the top-ranked example and its floodwater heatmap. Backup: screen recording if the network fails.');

// ================================================================ 5. diagram
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Waterline' });
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
text(s, [
  { text: 'LLMs: ', options: { bold: true, color: C.accent1 } },
  { text: 'Qwen on the USAA Datathon Qwen server debugged the forecaster’s training. App numbers come from trained models, not LLMs.' },
], { x: 0.6, y: 6.58, w: 12.1, h: 0.35, fontSize: 13 });
s.addNotes('[2:30–3:15] Left to right: four datasets feed four models; the app shows their results. The UTSA photo metadata picked the 18 river gauges we trained on. The forecaster was trained on the USAA Datathon Qwen server, where the Qwen LLM debugged the training code. No number in the app comes from an LLM.');


// ================================================================ 4. results + impact
s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Waterline' });
s.addText('What the models show, and why it matters', { placeholder: 'title' });
const res = [
  ['0.86', 'Photo flood classifier', 'Ranks a flooded photo above a dry one 86% of the time, tested on areas it never saw. Colour rule alone: 0.81. Chance: 0.50.'],
  ['~9%', 'less error than “river stays the same”', 'River forecaster on the two floods held out of training: 1.03 vs 1.13 ft error at 6 hours ahead.'],
];
res.forEach(([big, h, b], i) => {
  const y = 1.6 + i * 2.55;
  card(s, 0.6, y, 6.1, 2.35);
  text(s, big, { x: 0.95, y: y + 0.3, w: 2.2, h: 1.2, fontFace: 'Cambria', fontSize: 56, bold: true, color: C.text2 });
  text(s, h, { x: 3.1, y: y + 0.35, w: 3.4, h: 1.1, fontFace: 'Cambria', fontSize: 18, bold: true, color: C.text2, valign: 'middle' });
  text(s, b, { x: 0.95, y: y + 1.35, w: 5.5, h: 0.9, fontSize: 14, valign: 'top' });
});
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.1, y: 1.6, w: 5.6, h: 4.9, rectRadius: 0.12, fill: { color: C.text2 }, line: { color: C.text2 }, objectName: 'impact-card' });
text(s, 'Social impact: show how severe flash floods are', { x: 7.45, y: 1.85, w: 5.0, h: 0.75, fontFace: 'Cambria', fontSize: 22, bold: true, color: C.background1, valign: 'top' });
text(s, [
  { text: 'People underestimate flash floods. Waterline makes their speed and depth felt: ankle-deep to over your head in minutes.', options: { breakLine: true, bold: true } },
  { text: ' ', options: { breakLine: true, fontSize: 8 } },
  { text: 'Real Texas gauges and photos, replayed where you stand, so the danger feels local, not distant.', options: { breakLine: true } },
  { text: ' ', options: { breakLine: true, fontSize: 8 } },
  { text: 'For those most exposed: Hill Country river corridors and camps, low-water-crossing commuters, students new to Texas.', options: { breakLine: true } },
  { text: ' ', options: { breakLine: true, fontSize: 8 } },
  { text: 'Accessible: screen-reader labels, haptics and a no-camera view.' },
], { x: 7.45, y: 2.95, w: 4.95, h: 3.4, fontSize: 16, color: C.background1, valign: 'top' });
s.addNotes('[3:15–4:00] Results: the photo classifier, trained on 138 photos we labelled and agreed on, scores 0.86. The forecaster beats the “river stays the same” baseline on floods it never saw, though sudden surges remain hard. Our goal is awareness: flash floods rise in minutes, not hours, and seeing that where you stand makes people take warnings seriously. Thank you.');

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
})();
