// Service worker de la extensión.
//
// Hace el fetch al backend local en nombre del content script. Esto es
// necesario porque Chrome 142+ bloquea con Local Network Access los fetch
// a loopback (localhost / 127.0.0.1) iniciados desde el contexto de una
// página pública (content script en google.com). El service worker vive
// en el origen chrome-extension://<id>, fuera de la clasificación de
// origen público de LNA, así que con host_permissions declarado puede
// llegar a localhost:3000.
//
// Contrato:
//   in:  { tipo: "INTERPRETAR", texto: string, contexto: object }
//   out: { ok: true, data: <respuesta backend> }
//        { ok: false, error: <string> }
// Si la respuesta no llega o no es ok, content.js cae al fallback local
// (igual que cuando el fetch directo fallaba).

const BACKEND_URL = "http://localhost:3000/interpretar";
const TTS_URL = "http://localhost:3000/tts";
const EXPLICAR_PAGINA_URL = "http://localhost:3000/explicar-pagina";
// Groq (llama-3.3-70b) tarda típicamente 7-9s. 15s deja margen sin colgar.
const BACKEND_TIMEOUT_MS = 15000;
// ElevenLabs típicamente entrega audio en 1-3s. El backend ya tiene su
// propio timeout de 5s; aquí ponemos 8s para tolerar latencia de red sin
// que el cliente espere demasiado antes del fallback a Web Speech.
const TTS_TIMEOUT_MS = 8000;
// Mismo budget que /interpretar para el chat de página: el modelo tarda
// parecido y el payload es más grande que /interpretar.
const EXPLICAR_PAGINA_TIMEOUT_MS = 15000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.tipo !== "INTERPRETAR") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto: msg.texto, contexto: msg.contexto }),
    signal: controller.signal,
  })
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))
    )
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String((err && err.message) || err),
      })
    )
    .finally(() => clearTimeout(timer));

  // Mantener el canal de mensaje abierto hasta el sendResponse asíncrono.
  return true;
});

// TTS opcional vía backend → ElevenLabs. Mismo motivo que /interpretar:
// el fetch a loopback debe salir del origen chrome-extension://, no de
// un content script.
//
// Privacidad: solo enviamos el texto del mensaje del asistente. No URL,
// no contexto, no historial.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.tipo !== "TTS") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto: msg.texto }),
    signal: controller.signal,
  })
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))
    )
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String((err && err.message) || err),
      })
    )
    .finally(() => clearTimeout(timer));

  return true;
});

// Chat de página externa. Recibe pregunta + resumen seguro del DOM y
// devuelve mensaje + opcional índice de elemento a resaltar. El resumen
// ya viene saneado del cliente; el backend lo sanea otra vez.
//
// Privacidad: solo se envían {pregunta, historial, pagina}. El historial
// son turnos cortos del chat de página (texto saneado en cliente, cap por
// turno y por largo total). NO cookies, NO storage, NO HTML, NO values.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.tipo !== "EXPLICAR_PAGINA") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPLICAR_PAGINA_TIMEOUT_MS);

  fetch(EXPLICAR_PAGINA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // HITO 2E: agregamos `historial` (turnos previos del chat de página).
    // HITO 2F: `candidatos` opcionales (idx sugeridos por el ranking local).
    // Se reenvía tal cual; el backend lo sanea y lo cap-ea. Si llega
    // undefined, JSON.stringify lo omite (compatibilidad hacia atrás).
    body: JSON.stringify({
      pregunta: msg.pregunta,
      historial: msg.historial,
      pagina: msg.pagina,
      candidatos: msg.candidatos,
      // HITO 2G: flag opcional de modo sensible. undefined -> JSON lo omite.
      seguridad: msg.seguridad,
    }),
    signal: controller.signal,
  })
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))
    )
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String((err && err.message) || err),
      })
    )
    .finally(() => clearTimeout(timer));

  return true;
});
