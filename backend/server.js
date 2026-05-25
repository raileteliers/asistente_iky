import "dotenv/config";
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import {
  contieneAccionPrematura,
  esSolicitudFueraDeAlcance,
} from "./safety-rules.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

if (!process.env.GROQ_API_KEY) {
  console.error(
    "ERROR: GROQ_API_KEY no está definida. Copia backend/.env.example a backend/.env y agrega tu clave real (gsk_...)."
  );
  process.exit(1);
}

const client = new Groq();

// HITO S1: log de performance del backend, detrás de DEBUG_PERF=true. Nunca
// loguea API keys, texto del usuario, página ni historial completos.
function perfLogBackend(evento, data) {
  if (process.env.DEBUG_PERF !== "true") return;
  console.log("[Iky][perf]", evento, JSON.stringify(data || {}));
}

// En un 429, Groq manda en headers/cuerpo CUÁL límite se topó (requests vs
// tokens, por minuto vs diario) y el retry-after. Lo logueamos para medir el
// cuello real antes de optimizar. Solo metadata de rate-limit + el mensaje del
// proveedor: nada de texto de usuario, página ni claves (misma barra que perf).
function logRateLimit(endpoint, err) {
  const h = (err && err.headers) || {};
  const get = (k) => (typeof h.get === "function" ? h.get(k) : h[k]) || null;
  console.warn("[Iky][429]", endpoint, JSON.stringify({
    retryAfter: get("retry-after"),
    limitRequests: get("x-ratelimit-limit-requests"),
    remainingRequests: get("x-ratelimit-remaining-requests"),
    resetRequests: get("x-ratelimit-reset-requests"),
    limitTokens: get("x-ratelimit-limit-tokens"),
    remainingTokens: get("x-ratelimit-remaining-tokens"),
    resetTokens: get("x-ratelimit-reset-tokens"),
    mensaje: (err && err.error && err.error.message) || (err && err.message) || null,
  }));
}

const TIPOS_PERMITIDOS = new Set([
  "RESALTAR_BARRA",
  "GUIAR_BUSQUEDA",
  "EXPLICAR_RESULTADOS",
  "ABRIR_PRIMER_RESULTADO_SOLICITADO",
  "DESCONOCIDO",
]);

const SYSTEM_PROMPT = `Eres un clasificador de intención Y redactor de mensajes para una extensión que ayuda a adultos mayores chilenos a usar Google Search. No ejecutas acciones. Solo devuelves JSON válido siguiendo el esquema. Elige una intención de la lista cerrada Y redacta un mensaje breve para mostrar al usuario.

INTENCIONES PERMITIDAS

1. RESALTAR_BARRA
El usuario pregunta dónde escribir o dónde está la barra de búsqueda.
Ejemplos: "dónde busco", "dónde escribo", "no sé dónde tengo que escribir", "cuál es la barra de búsqueda".

2. GUIAR_BUSQUEDA
El usuario quiere buscar algo. Extrae la consulta LIMPIA y ÚTIL para Google en el campo "consulta". La consulta NO es una copia literal de la frase del usuario; es la frase que un buscador necesita.

Reglas para construir "consulta":
a) Quita verbos auxiliares: "quiero", "necesito", "me gustaría", "puede usted", "podría".
b) Si el usuario quiere "usar / abrir / entrar a / ingresar a / ir a" un servicio, sitio o marca conocida (ChatGPT, Gmail, WhatsApp Web, YouTube, Facebook, Netflix, Banco Estado, etc.), la consulta es SOLO el nombre del servicio. No incluyas "usar", "abrir", "entrar a" ni "ir a".
c) Si el usuario quiere "aprender a usar" / "cómo uso" / "enséñame a usar" un servicio o herramienta, la consulta empieza con "cómo usar".
d) Si el usuario quiere "aprender a hacer / preparar / cocinar" algo, conserva la acción útil ("hacer empanadas", "preparar cazuela").
e) Mantén nombres propios y marcas con su capitalización habitual (ChatGPT, WhatsApp Web, Gmail, YouTube, Banco Estado).
f) La consulta nunca debe empezar con "usar X" cuando X es un servicio o herramienta; ese caso siempre se reduce a "X" o a "cómo usar X" según las reglas anteriores.

Ejemplos:
- "quiero buscar receta de cazuela" → consulta: "receta de cazuela"
- "me gustaría aprender a hacer empanadas" → consulta: "hacer empanadas"
- "quiero ver cómo preparar cazuela" → consulta: "cómo preparar cazuela"
- "busca el clima en Santiago" → consulta: "el clima en Santiago"
- "quiero usar ChatGPT" → consulta: "ChatGPT"
- "quiero abrir Gmail" → consulta: "Gmail"
- "quiero entrar a YouTube" → consulta: "YouTube"
- "quiero usar WhatsApp Web" → consulta: "WhatsApp Web"
- "quiero aprender a usar ChatGPT" → consulta: "cómo usar ChatGPT"
- "cómo uso WhatsApp Web" → consulta: "cómo usar WhatsApp Web"
- "enséñame a usar Gmail" → consulta: "cómo usar Gmail"

3. EXPLICAR_RESULTADOS
El usuario está viendo los resultados de una búsqueda y pregunta qué hacer o qué significan.
Ejemplos: "qué hago ahora", "no entiendo los resultados", "cuál abro", "qué son estos resultados".

REGLA DE CONTEXTO IMPORTANTE:
El JSON del usuario incluye "Contexto" con un campo "estaEnResultados" (true | false). Úsalo para desambiguar.
- Si estaEnResultados=true y el usuario dice frases ambiguas como "ahora qué hago", "y ahora", "qué hago", "qué miro", "cuál abro", "cuál debería abrir", "qué debería hacer" → tipo = EXPLICAR_RESULTADOS.
- Si estaEnResultados=false con esas mismas frases → probablemente RESALTAR_BARRA o DESCONOCIDO según el texto exacto. NO uses EXPLICAR_RESULTADOS cuando el usuario aún no está en resultados.

4. ABRIR_PRIMER_RESULTADO_SOLICITADO
El usuario pide explícitamente abrir un resultado. La extensión pedirá confirmación antes de abrir; tú solo clasificas y redactas el mensaje.
Ejemplos: "abre el primero", "entra al primer resultado", "abre esa página", "quiero ver el primer resultado".

5. DESCONOCIDO
La intención no encaja con claridad en ninguna de las anteriores.

SOLICITUDES FUERA DE ALCANCE (siempre DESCONOCIDO)

Este asistente solo ayuda a buscar información general en Google. NO guía pagos, banca, credenciales ni instalación de software. Si el usuario pide pagar, transferir dinero, comprar, ingresar a un banco, usar o ingresar una clave/contraseña, hacer un trámite sensible, o instalar software, programas o extensiones, clasifica SIEMPRE como DESCONOCIDO. NO conviertas esas solicitudes en una búsqueda útil: NO devuelvas GUIAR_BUSQUEDA para esos temas, ni siquiera como "cómo pagar..." o "cómo instalar...".

Usuario: "paga esta cuenta"
{
  "tipo": "DESCONOCIDO",
  "consulta": null,
  "mensaje": "Por ahora puedo ayudarle a usar Google para buscar información general.",
  "confianza": 0.9
}

Usuario: "instala una extensión"
{
  "tipo": "DESCONOCIDO",
  "consulta": null,
  "mensaje": "Por ahora puedo ayudarle a usar Google para buscar información general.",
  "confianza": 0.9
}

REGLAS DEL CAMPO "mensaje"

- Español chileno neutro, amable, claro, apropiado para una persona mayor.
- Máximo 220 caracteres en total (espacios y puntuación incluidos).
- Una sola instrucción por mensaje. No mezcles temas.
- Sin jerga técnica ("URL", "click", "tab", "browser", "DOM"...).
- Sin Markdown (nada de **, ##, listas, enlaces [texto](...)).
- Sin HTML, sin etiquetas, sin emojis.
- NUNCA afirmes que ya ejecutaste una acción. La extensión decide cuándo ejecutar; tú solo guías. NO uses "abrí", "busqué", "hice clic", "entré". USA "le marqué", "podemos buscar", "si quiere puedo ayudarle".
- Si el tema parece médico, financiero o legal, agrega una oración corta recordando que esto solo ayuda a buscar información, no a decidir.

EJEMPLOS DE MENSAJE POR INTENCIÓN

RESALTAR_BARRA:
"No se preocupe. Le marqué la barra grande de Google, que es donde debe escribir lo que quiere buscar."

GUIAR_BUSQUEDA con consulta = "hacer empanadas":
"Podemos buscar 'hacer empanadas'. Le marqué la barra de Google para que pueda escribirlo ahí."

EXPLICAR_RESULTADOS:
"Estos son resultados de Google. Los títulos azules son páginas que puede abrir. Le marqué el primer resultado."

ABRIR_PRIMER_RESULTADO_SOLICITADO:
"Le marqué el primer resultado. Si quiere, puedo ayudarle a abrirlo en una pestaña nueva."

DESCONOCIDO:
"Puedo ayudarle a usar Google. Pruebe decirme qué quiere buscar o qué parte no entiende."

REGLAS DURAS DE CLASIFICACIÓN

- Si tipo = GUIAR_BUSQUEDA y no puedes extraer una consulta clara, usa DESCONOCIDO.
- Si la frase es ambigua o no encaja, usa DESCONOCIDO.
- "consulta" debe ser null si el tipo no es GUIAR_BUSQUEDA.
- "confianza" es un número entre 0.0 y 1.0 según qué tan seguro estás de la clasificación.
- Devuelve solo el JSON, sin texto antes ni después, sin bloques de markdown.

FORMATO DE RESPUESTA (JSON literal, sin desviaciones)

{
  "tipo": "RESALTAR_BARRA" | "GUIAR_BUSQUEDA" | "EXPLICAR_RESULTADOS" | "ABRIR_PRIMER_RESULTADO_SOLICITADO" | "DESCONOCIDO",
  "consulta": "<string si tipo=GUIAR_BUSQUEDA, sino null>",
  "mensaje": "<máximo 220 caracteres, una o dos oraciones>",
  "confianza": 0.0
}`;

const RESPUESTA_SEGURA_DESCONOCIDO = {
  tipo: "DESCONOCIDO",
  consulta: null,
  mensaje:
    "Puedo ayudarle a usar Google. Pruebe decirme qué quiere buscar o qué parte no entiende.",
  confianza: 0,
};

// Respuesta para solicitudes fuera del alcance del MVP (pagos, banca,
// credenciales, instalación de software/extensiones). consulta = null por
// consistencia con el resto del sistema: solo GUIAR_BUSQUEDA lleva consulta.
const RESPUESTA_FUERA_DE_ALCANCE = {
  tipo: "DESCONOCIDO",
  consulta: null,
  mensaje:
    "Por ahora puedo ayudarle a usar Google para buscar información general.",
  confianza: 0.9,
};

// Configuración TTS. Si API_KEY o VOICE_ID faltan, /tts responde
// ok:false y el frontend cae a Web Speech API sin error visible.
const ELEVENLABS_TIMEOUT_MS = 5000;
const TTS_MAX_CHARS = 600;
const TTS_DEFAULT_MODEL = "eleven_multilingual_v2";
// Velocidad de la voz (0.7 lento – 1.2 rápido; 1.0 = normal de ElevenLabs).
// Más lento ayuda a que un adulto mayor alcance a entender. Configurable por
// .env (ELEVENLABS_SPEED) para afinar de oído sin tocar código.
const TTS_SPEED = (() => {
  const v = parseFloat(process.env.ELEVENLABS_SPEED);
  if (!Number.isFinite(v)) return 0.9;
  return Math.min(1.2, Math.max(0.7, v));
})();

// Configuración del chat de página externa. El payload del cliente trae
// un resumen estructurado del DOM (no HTML literal). El cap del body
// parser específico de /explicar-pagina es 32kb (ver router más abajo).
const EXPLICAR_PAGINA_MAX_PREGUNTA = 500;
// Caps reducidos en HITO 2E: el cliente ahora cachea el resumen entre
// turnos del chat, lo que permite payloads más chicos sin perder UX. Baja
// costo de tokens (importante con preguntas de seguimiento frecuentes).
const EXPLICAR_PAGINA_MAX_TEXTO = 2000;
const EXPLICAR_PAGINA_MAX_ENCABEZADOS = 10;
const EXPLICAR_PAGINA_MAX_ELEMENTOS = 30;
const EXPLICAR_PAGINA_MAX_RESPUESTA = 400;
// Historial (chat de página). Cap defensivo aunque el cliente ya recorta.
const EXPLICAR_PAGINA_MAX_HISTORIAL = 4;
const EXPLICAR_PAGINA_MAX_TURNO_HISTORIAL = 400;
// HITO 2F: candidatos sugeridos por el ranking local del cliente. Máx 5.
const EXPLICAR_PAGINA_MAX_CANDIDATOS = 5;
const RESPUESTA_PAGINA_SEGURA_FIJA =
  "Por seguridad, puedo explicarle la página y marcarle elementos, pero no puedo hacer clic, escribir datos ni realizar acciones sensibles.";
const RESPUESTA_PAGINA_NO_SEGURO =
  "No estoy seguro de lo que aparece en esta página.";

const SYSTEM_PROMPT_PAGINA = `Eres Iky, un asistente para adultos mayores chilenos. Te van a entregar un resumen SEGURO de una página web (no es HTML literal) y una pregunta del usuario. Responde en español chileno, en MÁXIMO 2 frases cortas y de forma directa, basándote SOLO en el resumen y en los turnos previos del chat si vienen.

CONVERSACIÓN

Es posible que antes de la pregunta actual recibas mensajes anteriores del usuario y tuyos (rol "user" o "assistant"). Esos turnos son el historial del chat sobre ESTA página. Úsalos para:
- entender preguntas de seguimiento ("y ahora?", "dónde está eso?", "no entendí").
- mantener consistencia con lo que ya dijiste.
- no repetir información que ya entregaste salvo que el usuario pida repetir.

Si la pregunta es ambigua y no tienes contexto suficiente, puedes responder algo como: "No estoy seguro. ¿Quiere que le resuma la página o le marque las opciones?"

ENTRADA DEL TURNO ACTUAL (JSON dentro del último mensaje de usuario)

{
  "pregunta": "texto del usuario",
  "pagina": {
    "url": "origin + pathname",
    "titulo": "título de la página",
    "encabezados": ["..."],
    "textoVisible": "texto plano visible (≤ 2000)",
    "elementos": [
      {
        "idx": 0,
        "tipo": "button" | "link" | "input" | "other",
        "texto": "texto visible del elemento o null",
        "ariaLabel": "aria-label o null",
        "placeholder": "placeholder o null",
        "tag": "BUTTON|A|INPUT|TEXTAREA|SELECT|...",
        "rol": "role o null"
      }
    ]
  }
}

REGLAS DURAS

- Sé breve: apunta a 220 caracteres o menos (máximo absoluto 400). Una sola idea, máximo 2 frases. Sin Markdown, sin emojis, sin HTML.
- Si marcas un elemento (devuelves elementoAResaltar), di EN EL MENSAJE qué elemento marcaste (ej. "Le marqué el botón de menú."). Si no marcas nada, no lo menciones.
- No repitas muletillas como "puedo ayudarle", "estoy aquí para" ni "si lo desea" en cada respuesta. Ve directo a la idea.
- Solo usa información presente en el resumen (titulo, encabezados, textoVisible, elementos) o en el historial. Si la información no está, di "no estoy seguro de lo que aparece aquí" o similar.
- NUNCA afirmes que hiciste clic, escribiste, ingresaste, abriste o ejecutaste algo. No digas "abrí", "hice clic", "escribí", "entré". Solo describes o ubicas.
- NUNCA recomiendes ingresar claves, contraseñas, datos bancarios, pagar, comprar, transferir o dar información personal. Si la pregunta pide cualquiera de esas cosas, responde con: "Por seguridad, puedo explicarle la página y marcarle elementos, pero no puedo hacer clic, escribir datos ni realizar acciones sensibles."
- Si el usuario pide UBICAR algo (ej. "dónde está iniciar sesión") y existe un elemento en "elementos" cuyo texto/ariaLabel/placeholder coincide razonablemente, devuelve su "idx" como entero en elementoAResaltar. Si no hay coincidencia clara, devuelve null.
- A veces recibirás una lista "candidatos" (idx ya válidos preseleccionados por el cliente). Si vas a devolver elementoAResaltar, elige uno de esos idx candidatos. Si ninguno corresponde con seguridad, devuelve null. NUNCA elijas un idx fuera de "candidatos" cuando la lista venga presente.
- MODO SENSIBLE: si el sistema indica que la página es sensible (login/checkout/banca/identidad), NO guíes a iniciar sesión, ingresar, continuar, confirmar ni pagar. No sugieras apretar "iniciar sesión", "pagar" ni "confirmar". Solo explica el contenido general y, si acaso, menciona secciones NO sensibles (ayuda, contacto, privacidad). En modo sensible devuelve SIEMPRE elementoAResaltar = null.
- elementoAResaltar SOLO puede ser un entero entre 0 y elementos.length-1, o null. NO inventes índices. NO devuelvas selectores, NO devuelvas JS.

FORMATO DE RESPUESTA (JSON literal, sin texto antes ni después)

{
  "mensaje": "<breve: ≤220 caracteres ideal, máx 400; una idea>",
  "elementoAResaltar": <entero válido del arreglo elementos o null>
}`;

// El filtro de frases de acción prematura (FRASES_ACCION_PREMATURA y
// contieneAccionPrematura) vive en ./safety-rules.js para que el backend
// y la suite de eval compartan exactamente la misma lista.

// Mensaje seguro hardcoded por tipo. Se usa cuando la IA produjo un tipo
// válido pero un mensaje que no pasa los filtros (acción prematura, vacío,
// etc.). Mantiene la intención clasificada y reemplaza solo el texto.
function mensajeSeguroParaTipo(tipo, consulta) {
  switch (tipo) {
    case "RESALTAR_BARRA":
      return "Le marqué la barra de Google, que es donde debe escribir lo que quiere buscar.";
    case "GUIAR_BUSQUEDA":
      return consulta
        ? `Podemos buscar "${consulta}". Le marqué la barra de Google para que pueda escribirlo ahí.`
        : "Le marqué la barra de Google para que pueda escribir lo que quiere buscar.";
    case "EXPLICAR_RESULTADOS":
      return "Estos son los resultados de Google. Le marqué el primero, que suele ser el más útil.";
    case "ABRIR_PRIMER_RESULTADO_SOLICITADO":
      return "Le marqué el primer resultado. Si quiere, puedo ayudarle a abrirlo en una pestaña nueva.";
    case "DESCONOCIDO":
    default:
      return RESPUESTA_SEGURA_DESCONOCIDO.mensaje;
  }
}

// Sanea texto antes de pasarlo al cliente o a una API externa. Defensa
// contra prompt injection que intente filtrar HTML/JS aunque el cliente
// use textContent. Devuelve null si el texto no es usable.
// `maxChars` permite reutilizar el sanitizador para distintos contextos
// (mensaje IA = 220, texto TTS = 600).
function sanitizarTextoBase(m, maxChars) {
  if (typeof m !== "string") return null;
  let s = m.trim();
  if (!s) return null;
  // Rechazar payloads claramente peligrosos: tags ejecutables o handlers
  // de eventos inline. Si aparece algo así, descartamos el texto entero.
  if (/<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b/i.test(s)) {
    return null;
  }
  if (/\bon\w+\s*=/i.test(s)) return null;
  // Strip cualquier <, > residual (modelo puede mencionar "< 10" o similar).
  s = s.replace(/[<>]/g, "");
  // Colapsar todo whitespace (incluidos saltos de línea) a un solo espacio.
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > maxChars) s = s.slice(0, maxChars - 3).trimEnd() + "...";
  return s;
}

function sanitizarMensaje(m) {
  return sanitizarTextoBase(m, 220);
}

function sanitizarTextoTTS(m) {
  return sanitizarTextoBase(m, TTS_MAX_CHARS);
}

// El backend NO confía ciegamente en la IA: validamos tipo, consulta,
// confianza y mensaje antes de responder al cliente.
function validarRespuesta(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...RESPUESTA_SEGURA_DESCONOCIDO };
  }

  const tipoOriginal = TIPOS_PERMITIDOS.has(raw.tipo) ? raw.tipo : "DESCONOCIDO";
  let tipo = tipoOriginal;
  let consulta =
    typeof raw.consulta === "string" && raw.consulta.trim()
      ? raw.consulta.trim().slice(0, 200)
      : null;
  let mensaje = sanitizarMensaje(raw.mensaje);
  const confianza =
    typeof raw.confianza === "number" && Number.isFinite(raw.confianza)
      ? Math.max(0, Math.min(1, raw.confianza))
      : 0;

  // Reglas duras de seguridad:
  // 1) GUIAR_BUSQUEDA sin consulta válida no tiene sentido → DESCONOCIDO.
  if (tipo === "GUIAR_BUSQUEDA" && !consulta) tipo = "DESCONOCIDO";
  // 2) Confianza baja: degradar a DESCONOCIDO para no actuar sobre dudas.
  if (confianza < 0.5 && tipo !== "DESCONOCIDO") tipo = "DESCONOCIDO";
  // 3) Consulta solo tiene sentido en GUIAR_BUSQUEDA.
  if (tipo !== "GUIAR_BUSQUEDA") consulta = null;
  // 4) Si degradamos el tipo, el mensaje original era para la intención
  //    equivocada: lo descartamos y usamos uno seguro.
  if (tipo !== tipoOriginal) mensaje = null;
  // 5) Filtro de acción prematura: si el mensaje sugiere que la IA ya
  //    ejecutó o ejecutará algo, descartamos SOLO el mensaje (no el tipo)
  //    y usamos un fallback hardcoded para ese tipo.
  if (mensaje && contieneAccionPrematura(mensaje)) mensaje = null;
  // 6) Sin mensaje válido: fallback seguro acorde al tipo.
  if (!mensaje) mensaje = mensajeSeguroParaTipo(tipo, consulta);

  return { tipo, consulta, mensaje, confianza };
}

// CORS restringido. Orígenes legítimos:
//   - chrome-extension://<id>  → el service worker de la extensión
//     (ahora todos los fetch al backend salen de ahí; ver background.js)
//   - dominios de Google soportados (compatibilidad con versiones previas
//     del cliente, pre-service-worker)
//   - sin Origin → curl, suite de eval, health checks locales
const ORIGENES_PERMITIDOS = new Set([
  "https://www.google.com",
  "https://google.com",
  "https://www.google.cl",
  "https://google.cl",
]);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ORIGENES_PERMITIDOS.has(origin)) return callback(null, true);
      if (origin.startsWith("chrome-extension://")) return callback(null, true);
      return callback(new Error("Origen no permitido por CORS"));
    },
  })
);
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, model: MODEL }));

app.post("/interpretar", async (req, res) => {
  const _tReq = Date.now();
  const { texto, contexto } = req.body || {};

  if (typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ error: "Campo 'texto' es requerido." });
  }
  if (texto.length > 500) {
    return res.status(400).json({ error: "Texto demasiado largo." });
  }

  // Guardrail determinístico: pagos, banca, credenciales e instalación de
  // software/extensiones están fuera de alcance. Se fuerzan a DESCONOCIDO
  // sin consultar a Groq — no dependemos solo del prompt.
  if (esSolicitudFueraDeAlcance(texto)) {
    return res.json({ ...RESPUESTA_FUERA_DE_ALCANCE });
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      // Determinístico para clasificación de etiquetas cerradas.
      temperature: 0,
      max_tokens: 512,
      // json_object: garantiza que la respuesta sea JSON válido. Groq NO
      // soporta json_schema strict en modelos Llama (solo en openai/gpt-oss-*
      // y moonshotai/kimi-k2-*). Confiamos en el SYSTEM_PROMPT para el shape
      // y en validarRespuesta() para hacer cumplir el esquema post-hoc:
      // tipos fuera del enum → DESCONOCIDO, consulta vacía → DESCONOCIDO,
      // confianza < 0.5 → DESCONOCIDO.
      response_format: { type: "json_object" },
      // Groq usa el formato OpenAI: el system prompt va como mensaje, no
      // como parámetro top-level.
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Texto del usuario: "${texto}"\n\nContexto: ${JSON.stringify(
            contexto || {}
          )}`,
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      console.warn("/interpretar: respuesta sin contenido");
      return res.status(502).json({ error: "Respuesta del modelo vacía." });
    }

    let raw;
    try {
      raw = JSON.parse(content);
    } catch (_) {
      console.warn(
        "/interpretar: JSON inválido del modelo:",
        content.slice(0, 200)
      );
      return res.status(502).json({ error: "Respuesta no es JSON válido." });
    }

    perfLogBackend("request_fin", { endpoint: "/interpretar", duracionMs: Date.now() - _tReq, ok: true, provider: "groq" });
    return res.json(validarRespuesta(raw));
  } catch (err) {
    perfLogBackend("request_fin", { endpoint: "/interpretar", duracionMs: Date.now() - _tReq, ok: false, provider: "groq", status: err?.status || null });
    // Groq SDK expone .status estilo OpenAI (429 = rate limit, 5xx = server).
    if (err?.status === 429) {
      logRateLimit("/interpretar", err);
      return res.status(429).json({ error: "Rate limit." });
    }
    console.error("/interpretar error:", err?.message || err);
    return res.status(500).json({ error: "Error al consultar el modelo." });
  }
});

// TTS opcional vía ElevenLabs. Si las claves no están configuradas o la
// API falla/timeoutea, devolvemos ok:false con un error genérico — el
// frontend cae a Web Speech API sin sobresaltos.
//
// Privacidad: este endpoint sólo recibe el texto final del asistente que
// se va a leer. No recibe URL, contexto ni texto crudo del usuario.
app.post("/tts", async (req, res) => {
  const _tReq = Date.now();
  const { texto } = req.body || {};
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || TTS_DEFAULT_MODEL;

  if (!apiKey || !voiceId) {
    return res.json({ ok: false, error: "TTS_NO_CONFIGURADO" });
  }

  const limpio = sanitizarTextoTTS(texto);
  if (!limpio) {
    return res.status(400).json({ ok: false, error: "TEXTO_INVALIDO" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        // Solo enviamos `speed`; los demás voice_settings caen a los de la voz
        // configurada, así no alteramos su timbre cálido (multilingual_v2).
        body: JSON.stringify({ text: limpio, model_id: modelId, voice_settings: { speed: TTS_SPEED } }),
        signal: controller.signal,
      }
    );
    if (!r.ok) {
      perfLogBackend("request_fin", { endpoint: "/tts", duracionMs: Date.now() - _tReq, ok: false, provider: "elevenlabs", status: r.status });
      // No exponemos el status real al cliente: colapsa todo a un único
      // error genérico para no filtrar detalles operacionales.
      console.warn("/tts: ElevenLabs HTTP", r.status);
      return res.json({ ok: false, error: "TTS_NO_DISPONIBLE" });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    perfLogBackend("request_fin", { endpoint: "/tts", duracionMs: Date.now() - _tReq, ok: true, provider: "elevenlabs" });
    return res.json({
      ok: true,
      audioBase64: buf.toString("base64"),
      contentType: "audio/mpeg",
    });
  } catch (err) {
    perfLogBackend("request_fin", { endpoint: "/tts", duracionMs: Date.now() - _tReq, ok: false, provider: "elevenlabs", error: err && err.name === "AbortError" ? "timeout" : "error" });
    // AbortError (timeout) y errores de red caen aquí. Nunca logueamos
    // la clave; sólo el nombre del error o el mensaje corto.
    console.warn(
      "/tts: error",
      err && err.name === "AbortError" ? "timeout" : (err && err.message) || ""
    );
    return res.json({ ok: false, error: "TTS_NO_DISPONIBLE" });
  } finally {
    clearTimeout(timer);
  }
});

// ---- Chat de página externa ----
//
// Recibe la pregunta del usuario y un resumen SEGURO del DOM (no HTML).
// Devuelve un mensaje corto y opcionalmente un índice de elemento a
// resaltar en cliente. NUNCA devuelve selectores, JS, ni acciones.
//
// Privacidad: el cliente sólo envía título, encabezados, texto visible
// recortado y etiquetas de elementos interactivos (sin .value, sin
// passwords, sin cookies). Esta función sanea defensivamente otra vez.

function sanearPaginaPayload(pagina) {
  if (!pagina || typeof pagina !== "object") return null;

  const url = typeof pagina.url === "string" ? pagina.url.slice(0, 500) : "";
  const titulo =
    typeof pagina.titulo === "string"
      ? sanitizarTextoBase(pagina.titulo, 200) || ""
      : "";

  const encabezadosRaw = Array.isArray(pagina.encabezados) ? pagina.encabezados : [];
  const encabezados = [];
  for (const h of encabezadosRaw) {
    const s = sanitizarTextoBase(h, 120);
    if (s) encabezados.push(s);
    if (encabezados.length >= EXPLICAR_PAGINA_MAX_ENCABEZADOS) break;
  }

  let textoVisible = "";
  if (typeof pagina.textoVisible === "string") {
    textoVisible = sanitizarTextoBase(pagina.textoVisible, EXPLICAR_PAGINA_MAX_TEXTO) || "";
  }

  // Schema HITO 2D: elementos con campos separados (texto/ariaLabel/
  // placeholder/tag/rol) para que el modelo pueda distinguir mejor.
  // Aceptamos también "elementosInteractivos" como nombre alternativo por
  // si algún cliente viejo sigue mandando el shape anterior.
  const elementosRaw = Array.isArray(pagina.elementos)
    ? pagina.elementos
    : (Array.isArray(pagina.elementosInteractivos) ? pagina.elementosInteractivos : []);
  const TIPOS_VALIDOS_ELEMENTO = new Set(["button", "link", "input", "other"]);
  const elementos = [];
  for (const el of elementosRaw) {
    if (!el || typeof el !== "object") continue;
    const idxIn = Number.isInteger(el.idx) ? el.idx : (Number.isInteger(el.indice) ? el.indice : elementos.length);
    const tipoIn = typeof el.tipo === "string" ? el.tipo.toLowerCase() : "other";
    const tipo = TIPOS_VALIDOS_ELEMENTO.has(tipoIn) ? tipoIn : "other";
    const texto = el.texto != null ? sanitizarTextoBase(el.texto, 80) : null;
    const ariaLabel = el.ariaLabel != null ? sanitizarTextoBase(el.ariaLabel, 80) : null;
    const placeholder = el.placeholder != null ? sanitizarTextoBase(el.placeholder, 80) : null;
    // Si no hay ningún descriptor textual útil, descartamos el elemento.
    if (!texto && !ariaLabel && !placeholder) continue;
    const tag = typeof el.tag === "string" ? el.tag.slice(0, 16).toUpperCase() : null;
    const rol = typeof el.rol === "string" ? el.rol.slice(0, 32) : null;
    elementos.push({ idx: idxIn, tipo, texto, ariaLabel, placeholder, tag, rol });
    if (elementos.length >= EXPLICAR_PAGINA_MAX_ELEMENTOS) break;
  }

  return { url, titulo, encabezados, textoVisible, elementos };
}

// HITO 2F: sanea los candidatos sugeridos por el ranking local del cliente.
// Solo conserva idx ENTEROS y EN RANGO del arreglo elementos ya saneado, con
// texto/razon recortados y score numérico. Máx EXPLICAR_PAGINA_MAX_CANDIDATOS.
// Si el input es inválido o ningún idx es válido, devuelve [].
function sanearCandidatos(candidatos, paginaSegura) {
  if (!Array.isArray(candidatos)) return [];
  const max = paginaSegura.elementos.length - 1;
  const out = [];
  for (const c of candidatos) {
    if (!c || typeof c !== "object") continue;
    if (!Number.isInteger(c.idx) || c.idx < 0 || c.idx > max) continue;
    const texto = c.texto != null ? sanitizarTextoBase(c.texto, 80) : null;
    const razon = c.razon != null ? sanitizarTextoBase(c.razon, 120) : null;
    const score = Number.isFinite(c.score) ? Math.round(c.score) : null;
    out.push({ idx: c.idx, texto, razon, score });
    if (out.length >= EXPLICAR_PAGINA_MAX_CANDIDATOS) break;
  }
  return out;
}

// HITO 2G: sanea el flag de seguridad enviado por el cliente. Solo acepta
// niveles conocidos y razones como etiquetas cortas (jamás datos del usuario;
// el cliente ya manda razones genéricas). Devuelve null si no es sensible o
// el input es inválido — así el handler sigue el camino normal.
function sanearSeguridad(seguridad) {
  if (!seguridad || typeof seguridad !== "object" || seguridad.esSensible !== true) return null;
  const nivel = seguridad.nivel === "ALTO" || seguridad.nivel === "MEDIO" ? seguridad.nivel : "MEDIO";
  const razones = Array.isArray(seguridad.razones)
    ? seguridad.razones
        .filter((r) => typeof r === "string")
        .map((r) => sanitizarTextoBase(r, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { esSensible: true, nivel, razones };
}

// Sanea el historial del chat de página. Acepta un array de turnos
// {rol: "usuario"|"asistente", texto}. Devuelve los últimos N turnos
// con texto saneado. Si el input es inválido, devuelve []. NUNCA se
// pasan al modelo turnos no saneados.
function sanearHistorialPagina(historial) {
  if (!Array.isArray(historial)) return [];
  const out = [];
  for (const turno of historial) {
    if (!turno || typeof turno !== "object") continue;
    const rol = turno.rol === "asistente" ? "asistente"
              : (turno.rol === "usuario" ? "usuario" : null);
    if (!rol) continue;
    const texto = sanitizarTextoBase(turno.texto, EXPLICAR_PAGINA_MAX_TURNO_HISTORIAL);
    if (!texto) continue;
    out.push({ rol, texto });
  }
  // El cliente ya recorta, pero capear defensivamente acá también.
  return out.slice(-EXPLICAR_PAGINA_MAX_HISTORIAL);
}

function validarRespuestaPagina(raw, paginaSegura) {
  if (!raw || typeof raw !== "object") {
    return { mensaje: RESPUESTA_PAGINA_NO_SEGURO, elementoAResaltar: null };
  }
  let mensaje = sanitizarTextoBase(raw.mensaje, EXPLICAR_PAGINA_MAX_RESPUESTA);
  if (!mensaje || contieneAccionPrematura(mensaje)) {
    mensaje = RESPUESTA_PAGINA_NO_SEGURO;
  }
  let elementoAResaltar = null;
  if (Number.isInteger(raw.elementoAResaltar)) {
    const idx = raw.elementoAResaltar;
    const max = paginaSegura.elementos.length - 1;
    if (idx >= 0 && idx <= max) elementoAResaltar = idx;
  }
  return { mensaje, elementoAResaltar };
}

async function explicarPaginaHandler(req, res) {
  const _tReq = Date.now();
  const { pregunta, historial, pagina } = req.body || {};

  if (typeof pregunta !== "string" || !pregunta.trim()) {
    return res.status(400).json({ error: "Campo 'pregunta' es requerido." });
  }
  if (pregunta.length > EXPLICAR_PAGINA_MAX_PREGUNTA) {
    return res.status(400).json({ error: "Pregunta demasiado larga." });
  }

  // Guardrail temprano: si la pregunta pide acción sensible, mensaje fijo
  // sin consultar al modelo. Misma lista que /interpretar.
  if (esSolicitudFueraDeAlcance(pregunta)) {
    return res.json({
      mensaje: RESPUESTA_PAGINA_SEGURA_FIJA,
      elementoAResaltar: null,
    });
  }

  const paginaSegura = sanearPaginaPayload(pagina);
  if (!paginaSegura) {
    return res.status(400).json({ error: "Campo 'pagina' es requerido." });
  }

  // HITO 2E: historial del chat de página (turnos previos). Se incluyen
  // como mensajes "user"/"assistant" antes del turno actual. Los turnos
  // ya están saneados; los rols se mapean al vocabulario de Groq.
  const historialSeguro = sanearHistorialPagina(historial);
  // HITO 2F: candidatos sugeridos por el cliente (idx ya válidos). Si vienen,
  // se inyectan como restricción para que el modelo elija entre pocos.
  const candidatosSeguros = sanearCandidatos(req.body && req.body.candidatos, paginaSegura);
  // HITO 2G: flag de seguridad. Si la página es sensible, reforzamos el prompt
  // y forzamos elementoAResaltar = null al final (no se confía en el modelo).
  const seguridadSegura = sanearSeguridad(req.body && req.body.seguridad);

  const messages = [{ role: "system", content: SYSTEM_PROMPT_PAGINA }];
  for (const turno of historialSeguro) {
    messages.push({
      role: turno.rol === "asistente" ? "assistant" : "user",
      content: turno.texto,
    });
  }
  // En modo sensible, candidatos no aplican (no resaltamos). Solo refuerzo.
  if (seguridadSegura) {
    messages.push({
      role: "system",
      content:
        "ATENCIÓN: esta página es SENSIBLE (nivel " + seguridadSegura.nivel + "). " +
        "No guíes a iniciar sesión, ingresar, continuar, confirmar ni pagar. " +
        "No sugieras apretar botones de login/pago/confirmación. Solo explica el " +
        "contenido general y, si corresponde, menciona secciones no sensibles " +
        "(ayuda, contacto, privacidad). Devuelve elementoAResaltar = null.",
    });
  } else if (candidatosSeguros.length > 0) {
    messages.push({
      role: "system",
      content:
        "El cliente sugiere estos candidatos (idx ya válidos del arreglo elementos): " +
        JSON.stringify(candidatosSeguros) +
        ". Si vas a devolver elementoAResaltar, elige uno de estos idx. " +
        "Si ninguno corresponde con seguridad, devuelve null.",
    });
  }
  // Turno actual: la pregunta acompañada del resumen estructurado.
  messages.push({
    role: "user",
    content: JSON.stringify({ pregunta, pagina: paginaSegura }),
  });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 256,
      response_format: { type: "json_object" },
      messages,
    });
    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      return res.json({
        mensaje: RESPUESTA_PAGINA_NO_SEGURO,
        elementoAResaltar: null,
      });
    }
    let raw;
    try {
      raw = JSON.parse(content);
    } catch (_) {
      console.warn("/explicar-pagina: JSON inválido:", content.slice(0, 200));
      return res.json({
        mensaje: RESPUESTA_PAGINA_NO_SEGURO,
        elementoAResaltar: null,
      });
    }
    const resultado = validarRespuestaPagina(raw, paginaSegura);
    // HITO 2G: en modo sensible, nunca resaltamos (aunque el modelo lo intente).
    if (seguridadSegura) resultado.elementoAResaltar = null;
    perfLogBackend("request_fin", { endpoint: "/explicar-pagina", duracionMs: Date.now() - _tReq, ok: true, provider: "groq", sensible: !!seguridadSegura });
    return res.json(resultado);
  } catch (err) {
    perfLogBackend("request_fin", { endpoint: "/explicar-pagina", duracionMs: Date.now() - _tReq, ok: false, provider: "groq", status: err?.status || null });
    if (err?.status === 429) {
      logRateLimit("/explicar-pagina", err);
      return res.status(429).json({ error: "Rate limit." });
    }
    console.error("/explicar-pagina error:", err?.message || err);
    return res.status(500).json({ error: "Error al consultar el modelo." });
  }
}

// Router con su propio body parser (32kb) para no inflar el límite global
// de /interpretar y /tts (10kb).
const explicarPaginaRouter = express.Router();
explicarPaginaRouter.use(express.json({ limit: "32kb" }));
explicarPaginaRouter.post("/", explicarPaginaHandler);
app.use("/explicar-pagina", explicarPaginaRouter);

app.listen(PORT, () => {
  console.log(`Asistente backend (Groq · ${MODEL}) escuchando en http://localhost:${PORT}`);
});
