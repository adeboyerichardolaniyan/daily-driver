// Self-contained typography and physical dimensions for both preview and print worker.
// System serif/monospace fonts keep printing offline with no external font requests.
export const receiptStyles = `
@page { size:80mm auto; margin:4mm; }
:root { color-scheme:light; --ink:#111; --rule:#666; --serif:Georgia,"Times New Roman",serif; --mono:"Courier New",monospace; }
* { box-sizing:border-box; }
html { background:#fff; }
body { width:72mm; max-width:100%; margin:0 auto; padding:4mm 0 2mm; background:#fff; color:var(--ink); font:12px/1.4 var(--serif); overflow-wrap:anywhere; font-synthesis:none; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1,h2,p,ul { margin:0; }
ul { list-style:none; padding:0; }
.receipt-header { text-align:center; padding-bottom:5mm; }
.masthead { display:flex; justify-content:space-between; gap:3mm; background:var(--ink); color:#fff; padding:2mm 3mm; font:9px/1.3 var(--mono); text-transform:uppercase; letter-spacing:2px; }
.dateline { font:9px/1.5 var(--mono); letter-spacing:1px; text-transform:uppercase; margin:3mm 0 1.5mm; }
h1.long-heading { font-size:19px; line-height:1.3; }
h1 { font:italic 26px/1.12 var(--serif); letter-spacing:-.7px; text-wrap:balance; }
.day-summary { display:flex; align-items:center; gap:4mm; padding:4mm 0; border-block:1px solid var(--ink); margin-bottom:1mm; }
.summary-number { font:46px/.95 var(--serif); letter-spacing:-2px; flex-shrink:0; font-variant-numeric:tabular-nums; }
.summary-number span { display:block; text-align:center; font:8px/1.5 var(--mono); text-transform:uppercase; letter-spacing:1.5px; margin-top:1mm; }
.summary-copy { min-width:0; }
.eyebrow { font:8px/1.5 var(--mono); text-transform:uppercase; letter-spacing:1.2px; }
.summary-caption { font-style:italic; font-size:14px; margin:1mm 0; }
.summary-details { font:8px/1.6 var(--mono); text-transform:uppercase; letter-spacing:.3px; }
.receipt-section { padding-top:4mm; }
.section-label { display:flex; align-items:baseline; gap:2.5mm; padding-bottom:1.4mm; margin-bottom:2mm; border-bottom:.5px solid var(--rule); font:9px/1.4 var(--mono); text-transform:uppercase; letter-spacing:1.4px; break-after:avoid; }
.section-label span { flex-shrink:0; font-variant-numeric:tabular-nums; }
.task-item { padding:1.2mm 0; break-inside:avoid; }
.task-line { display:flex; align-items:baseline; gap:1.8mm; }
.checkbox { display:inline-block; width:2.7mm; height:2.7mm; border:1px solid var(--ink); flex:0 0 2.7mm; transform:translateY(.35mm); }
.task-title { font-size:13px; line-height:1.35; min-width:0; }
.leader { flex:1 0 2mm; border-bottom:1px dotted var(--rule); }
.duration { white-space:nowrap; font-size:12px; font-weight:bold; font-variant-numeric:tabular-nums; }
.task-context { margin:1mm 0 0 4.5mm; font:8px/1.5 var(--mono); }
.task-hint { margin:.8mm 0 0 4.5mm; font-size:10px; line-height:1.4; font-style:italic; }
.agenda li { display:grid; grid-template-columns:22mm minmax(0,1fr); gap:2mm; padding:1.5mm 0; break-inside:avoid; }
.event-time { font:8px/1.7 var(--mono); font-variant-numeric:tabular-nums; }
.event-title { font-size:13px; line-height:1.35; }
.notes-grid { width:100%; height:28mm; display:block; margin-top:2mm; }
.custom-text { white-space:pre-wrap; font-size:13px; line-height:1.5; }
.empty { font-size:12px; font-style:italic; padding:1mm 0; }
.collection-section { break-inside:avoid; }
.reflection { text-align:center; padding:1mm 3mm 3mm; }
.quote-mark { display:block; height:7mm; font:bold 35px/1 var(--serif); }
.reflection > p:not(.attribution) { font:italic 18px/1.3 var(--serif); text-wrap:pretty; white-space:pre-wrap; }
.attribution { font:8px/1.6 var(--mono); letter-spacing:1.2px; text-transform:uppercase; margin-top:3mm; }
.receipt-qr { display:flex; align-items:center; justify-content:center; gap:3mm; border-top:1px solid var(--rule); margin-top:5mm; padding:3mm 0; break-inside:avoid; }
.receipt-qr img { display:block; width:23mm; height:23mm; flex-shrink:0; image-rendering:pixelated; }
.receipt-qr .eyebrow { font-size:8px; letter-spacing:.8px; }
.receipt-qr p + p { font-size:10px; line-height:1.5; margin-top:1mm; }
.weather-report { display:flex; gap:3mm; align-items:center; }
.weather-temperature { font:42px/1 var(--serif); flex-shrink:0; letter-spacing:-1px; }
.weather-temperature span { font:9px var(--mono); letter-spacing:0; }
.weather-description { font-size:14px; font-style:italic; margin:1mm 0; }
.weather-range,.weather-credit { font:8px/1.6 var(--mono); }
.weather-credit { margin-top:2mm; }
.receipt-metrics { margin:0; }
.receipt-metrics > div { display:flex; justify-content:space-between; gap:3mm; padding:1mm 0; }
.receipt-metrics dt { font-size:11px; }
.receipt-metrics dd { margin:0; text-align:right; font:9px/1.6 var(--mono); }
footer { text-align:center; border-top:1px solid var(--ink); padding:4mm 2mm 1mm; break-inside:avoid; }
footer > p:not(.attribution) { font:italic 18px/1.3 var(--serif); text-wrap:balance; }
.wordmark { display:block; font:8px/1.5 var(--mono); letter-spacing:2.5px; text-transform:uppercase; margin-top:2mm; }
`;
