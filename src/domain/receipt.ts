import QRCode from "qrcode";
import { weatherDescription } from "./weather";
import { receiptStyles } from "./receipt-styles";
import { receiptSchema, type ReceiptSnapshot } from "./receipt-schema";
export { receiptSchema, type ReceiptSnapshot } from "./receipt-schema";
export { createReceipt, createBriefing } from "./receipt-builder";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export async function renderReceipt(input: ReceiptSnapshot): Promise<string> {
  const snapshot = receiptSchema.parse(input);
  const sections = snapshot.template?.sections ?? [
    { id: "tasks", kind: "tasks", title: "On your list today", text: "" },
    { id: "notes", kind: "notes", title: "Notes", text: "" },
  ];
  const hasTasks = sections.some((s) => s.kind === "tasks");
  const hasCalendar = sections.some((s) => s.kind === "calendar");
  const taskCount = hasTasks ? snapshot.tasks.length : 0;
  const eventCount = hasCalendar ? (snapshot.events?.length ?? 0) : 0;
  const minutes = hasTasks
    ? snapshot.tasks.reduce((sum, task) => sum + task.minutes, 0)
    : 0;
  const date = snapshot.day ? new Date(`${snapshot.day}T12:00:00Z`) : null;
  const issue = date
    ? String(
        Math.floor(
          (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000,
        ) + 1,
      ).padStart(3, "0")
    : null;
  const dateline = date
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        weekday: "long",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date)
    : snapshot.date;
  const url =
    snapshot.briefingUrl ||
    (snapshot.tasks[0]
      ? new URL("/?view=briefings", snapshot.tasks[0].url).toString()
      : "");
  const qr =
    url && snapshot.template?.showQr !== false
      ? await QRCode.toDataURL(url, {
          width: 228,
          margin: 4,
          errorCorrectionLevel: "M",
        })
      : "";
  const body = sections
    .map((section, index) => {
      const heading = `<h2 class="section-label"><span>${String(index + 1).padStart(2, "0")}</span>${escape(section.title)}</h2>`;
      let content = "";
      if (section.kind === "tasks") {
        content = snapshot.tasks.length
          ? `<ul class="task-list">${snapshot.tasks
              .map(
                (task) =>
                  `<li class="task-item"><div class="task-line"><span class="checkbox" aria-hidden="true"></span><span class="task-title">${escape(task.title)}</span><span class="leader" aria-hidden="true"></span><span class="duration">${task.minutes} min</span></div>${
                    task.context || task.scheduledTime
                      ? `<p class="task-context">${[
                          task.context,
                          task.scheduledTime,
                        ]
                          .filter(Boolean)
                          .map((value) => escape(value!))
                          .join(" · ")}</p>`
                      : ""
                  }${task.doneWhen && snapshot.template?.showDoneWhen !== false ? `<p class="task-hint">${escape(task.doneWhen)}</p>` : ""}</li>`,
              )
              .join("")}</ul>`
          : '<p class="empty">A little room in your day.</p>';
      } else if (section.kind === "calendar") {
        content = snapshot.events?.length
          ? `<ul class="agenda">${snapshot.events.map((event) => `<li><span class="event-time">${escape(event.time)}</span><span class="event-title">${escape(event.title)}</span></li>`).join("")}</ul>`
          : '<p class="empty">No events on your calendar.</p>';
      } else if (section.kind === "weather") {
        const weather = snapshot.weather;
        content = weather
          ? `<div class="weather-report"><div class="weather-temperature">${Math.round(weather.temperature)}°<span>${weather.location.unit === "celsius" ? "C" : "F"}</span></div><div><p class="eyebrow">${escape(weather.location.name)}</p><p class="weather-description">${weatherDescription(weather.code)}</p><p class="weather-range">H ${Math.round(weather.high)}° · L ${Math.round(weather.low)}°${weather.rain !== null ? ` · Rain ${Math.round(weather.rain)}%` : ""}</p></div></div><p class="weather-credit">${weather.stale ? "Cached · " : ""}Updated ${escape(new Date(weather.fetchedAt).toLocaleTimeString("en-US", { timeZone: weather.timeZone, hour: "numeric", minute: "2-digit" }))} · Open-Meteo</p>`
          : '<p class="empty">Weather unavailable. Choose a location and refresh.</p>';
      } else if (section.kind === "overview") {
        content = `<dl class="receipt-metrics">${(snapshot.overview ?? []).map((item) => `<div><dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd></div>`).join("")}</dl>`;
      } else if (section.kind === "notes") {
        content = `<svg class="notes-grid" viewBox="0 0 272 108" xmlns="http://www.w3.org/2000/svg" aria-label="Space for handwritten notes" role="img"><defs><pattern id="dots-${index}" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r=".55" fill="#777"/></pattern></defs><rect width="272" height="108" fill="url(#dots-${index})"/></svg>`;
      } else if (section.kind === "collection") {
        const item = snapshot.content?.find(
          (item) => item.sectionId === section.id,
        );
        content = `<div class="reflection"><span class="quote-mark" aria-hidden="true">“</span><p>${escape(item?.text || "No approved entries yet.")}</p>${item?.attribution ? `<p class="attribution">${escape(item.attribution)}</p>` : ""}</div>`;
      } else {
        content = `<p class="custom-text">${escape(section.text)}</p>`;
      }
      return `<section class="receipt-section ${section.kind === "collection" ? "collection-section" : ""}">${heading}${content}</section>`;
    })
    .join("");
  const summary =
    hasTasks || hasCalendar
      ? `<div class="day-summary"><div class="summary-number">${hasTasks ? minutes : eventCount}<span>${hasTasks ? "min" : "events"}</span></div><div class="summary-copy"><p class="eyebrow">${hasTasks ? "One step at a time" : "Your day ahead"}</p><p class="summary-caption">${hasTasks ? "A little progress, today." : "Make room for what matters."}</p><p class="summary-details">${[hasTasks ? `${taskCount} ${taskCount === 1 ? "step" : "steps"}` : "", hasCalendar ? `${eventCount} calendar ${eventCount === 1 ? "event" : "events"}` : ""].filter(Boolean).join(" · ")}</p></div></div>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Daily briefing</title><style>${receiptStyles}</style></head><body><header class="receipt-header"><div class="masthead"><span>Daily notes</span><span>${issue ? `No. ${issue}` : "Daily Driver"}</span></div><p class="dateline">${escape(dateline)}</p><h1${snapshot.title.length > 120 ? ' class="long-heading"' : ""}>${escape(snapshot.title)}</h1>${snapshot.titleAttribution ? `<p class="attribution">${escape(snapshot.titleAttribution)}</p>` : ""}</header>${summary}<main>${body}</main>${qr ? `<section class="receipt-qr"><img src="${qr}" alt="Open this briefing on your phone"/><div><p class="eyebrow">Take your day with you</p><p>Scan to open your briefing<br>and check off each step.</p></div></section>` : ""}<footer><p>${escape(snapshot.closingLine ?? snapshot.template?.footer ?? "You only need to start here.")}</p>${snapshot.closingAttribution ? `<p class="attribution">${escape(snapshot.closingAttribution)}</p>` : ""}<span class="wordmark">Daily Driver</span></footer></body></html>`;
}
