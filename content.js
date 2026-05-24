(function () {
  if (window.__asistenteGoogleCargado) return;
  window.__asistenteGoogleCargado = true;

  // HITO S1 — instrumentación de fluidez/latencia. Solo console.debug, detrás
  // de un flag; no cambia comportamiento ni envía telemetría externa.
  const AG_DEBUG_PERF = true;

  // Log de performance, suprimido salvo que AG_DEBUG_PERF esté activo.
  function perfLog(evento, data) {
    if (!AG_DEBUG_PERF) return;
    console.debug("[Iky][perf]", evento, data || {});
  }

  // Marca de tiempo monotónica para medir duraciones.
  function perfNow() {
    return performance.now();
  }

  // Milisegundos transcurridos desde una marca devuelta por perfNow().
  function perfDuracion(inicio) {
    return Math.round(performance.now() - inicio);
  }

  let _perfPreguntaInicio = 0;
  let _perfTtsInicio = 0;

  const RESPUESTA_RESALTAR = "Le marqué dónde escribir. Escriba ahí.";
  const RESPUESTA_NO_ENCONTRADA = "No encontré dónde escribir.";
  const RESPUESTA_DESCONOCIDO = "Le marco dónde escribir en Google.";
  const RESPUESTA_BARRA_VACIA = "Primero escriba qué quiere buscar.";
  const RESPUESTA_EXPLICAR_RESULTADOS = "Estos son los resultados. Los títulos azules son páginas. Le marqué el primero.";
  const RESPUESTA_NO_EN_RESULTADOS = "Primero busque algo en Google. Después le explico los resultados.";
  // S2: mensajes de cancelación reutilizados en dos puntos del flujo Google
  // (botón "Cancelar" y rechazo conversacional). Centralizados para no divergir.
  const CANCEL_BUSQUEDA = "Bien. Presione Enter cuando quiera buscar.";
  const CANCEL_ABRIR = "Bien. Haga clic en el título marcado.";
  // Mensaje seguro local cuando el cliente detecta términos sensibles
  // (pagos, banca, claves, compras, acciones de riesgo). El backend ya
  // bloquea estos casos; esto es defensa adicional en cliente que además
  // evita gastar cuota del modelo en frases que nunca se ejecutarían.
  const RESPUESTA_FUERA_DE_ALCANCE_LOCAL =
    "Por seguridad no puedo ayudar con pagos, compras ni claves.";

  // ---- Política de riesgo (defensa en cliente) ----
  // Palabras sueltas: buscar con \b para evitar substrings inocentes
  // (ej. "página" normalizada a "pagina" NO debe activar "paga").
  const TERMINOS_SENSIBLES_PALABRAS = [
    "plata", "dinero",
    // Variantes de pagar (3p, imperativo, infinitivo, sustantivo). Backend
    // ya tiene "paga"/"pagar"; aquí ampliamos para frases como "transfiere"
    // o "pague usted".
    "pago", "pagos", "pagar", "paga", "pague",
    "transferencia", "transferir", "transfiere",
    "banco", "bancaria", "bancario",
    "tarjeta",
    "comprar", "compra", "compre", "compres",
    "clave", "contrasena", "password",
    // "uber" se trata como sensible para bloquear pedir/confirmar/aceptar
    // viaje. Acepto el costo de bloquear "qué es Uber" en el MVP — luego
    // afinamos a frases específicas ("pide uber", "llama uber").
    "uber",
  ];
  // Frases multi-palabra: substring directo sobre el texto normalizado.
  // "iniciar sesion" se sacó de aquí porque rompía preguntas legítimas en
  // página externa ("Iky, dónde está iniciar sesión"). Las acciones
  // imperativas ("inicia sesión por mí") se bloquean en el backend
  // /explicar-pagina vía SYSTEM_PROMPT_PAGINA + esSolicitudFueraDeAlcance.
  // El cliente nunca hace login: no escribe, no clickea, no submitea.
  const TERMINOS_SENSIBLES_FRASES = [
    "cuenta bancaria",
    "cuenta corriente",
    "confirmar viaje",
    "aceptar tarifa",
  ];
  // Prefijos que ejecutan directo (riesgo BAJO, sin confirmar): verbos de
  // búsqueda y frases de uso/acceso a un sitio. Si la consulta empieza así,
  // "quiero usar ChatGPT" busca en Google en un paso. Abrir el resultado igual
  // pide confirmación (ABRIR_PRIMER_RESULTADO sigue siendo MEDIO).
  const VERBOS_BUSQUEDA_DIRECTA = [
    "busca ",
    "buscame ",
    "buscar ",
    "quiero buscar ",
    "necesito buscar ",
    "ayudame a buscar ",
    // Frases de uso/acceso: "quiero usar ChatGPT", "quiero ir a youtube".
    "quiero usar ",
    "quiero abrir ",
    "quiero entrar a ",
    "quiero ir a ",
    "necesito usar ",
    "necesito abrir ",
    "abre ",
    "abreme ",
  ];

  // ---- Branding / nombre del asistente ----
  // El nombre visible es "Iky" (corto y memorable para adultos mayores),
  // pero las voces TTS lo pronuncian mejor escrito como "Iqui". Por eso
  // separamos texto visible y texto hablado para el saludo.
  const AG_NOMBRE_ASISTENTE = "Iky";
  const AG_NOMBRE_ASISTENTE_TTS = "Iqui";
  // Palabras clave aceptadas en modo escucha. Deben estar en minúsculas y
  // sin tildes porque la comparación se hace contra texto ya normalizado.
  // "Iky" no es palabra del español, así que el motor de reconocimiento
  // (Web Speech API es-CL) la transcribe como variantes fonéticas. Las
  // que terminan en "ikki", "kiki", "vicky" vienen observadas en logs
  // reales de uso. NO incluimos "aquí": es palabra común y daría falsos
  // positivos en preguntas naturales como "cómo busco aquí".
  const AG_PALABRAS_CLAVE_ESCUCHA = [
    "asistente",
    "iky", "iqui",                  // formas oficiales (escrita y TTS)
    "ique", "iki", "iqi", "icky",   // variantes fonéticas razonables
    "ikki", "kiki", "vicky",        // variantes vistas en logs reales
  ];
  const AG_SALUDO_VISIBLE =
    "Hola, soy Iky. Seré su asistente para guiarle paso a paso.";
  const AG_SALUDO_TTS =
    "Hola, soy Iqui. Seré su asistente para guiarle paso a paso.";
  // En páginas externas Iky se muestra como chat contextual sobre la
  // página visible. El saludo cambia para no prometer ayuda con Google.
  const AG_SALUDO_PAGINA_EXTERNA =
    "Veo esta página. Puedo guiarlo si lo desea.";
  // Respuesta fija cuando el usuario, en página externa, pide buscar en
  // Google. No abrimos pestaña — el usuario decide si vuelve.
  const RESPUESTA_VOLVER_A_GOOGLE =
    "Para buscar en Google, vuelva a esa pestaña.";

  // ---- Persistencia de chat por pestaña (sessionStorage) ----
  const STORAGE_KEY = "AG_ESTADO_CHAT_V1";
  // Preferencia de voz activada/desactivada (localStorage, persiste entre cargas).
  const VOZ_KEY = "AG_VOZ_ACTIVADA_V1";
  // Preferencia de modo escucha (localStorage). Por defecto ACTIVO: el usuario
  // adulto mayor abre el panel y ya puede hablar sin presionar "Activar". Si
  // toggle manualmente a OFF, queda OFF entre sesiones hasta que lo vuelva
  // a encender.
  const MODO_ESCUCHA_KEY = "AG_MODO_ESCUCHA_ACTIVADO_V1";
  // Memoria conversacional del chat de página externa (sessionStorage, por
  // pestaña). Guardamos solo {urlKey, historial}. NUNCA guardamos el resumen
  // del DOM ni textoVisible ni la lista de elementos: eso vive solo en memoria.
  const CHAT_PAGINA_KEY = "AG_CHAT_PAGINA_V1";
  // Cap del historial persistido en sessionStorage. El backend recibe un
  // subconjunto aún más chico (HISTORIAL_BACKEND_MAX).
  const HISTORIAL_CHAT_MAX = 10;
  const HISTORIAL_BACKEND_MAX = 4;
  // Caps reducidos para chat de página (HITO 2E): textoVisible 3000→2000,
  // encabezados 20→10, elementos 50→30. Bajan costo de tokens y latencia
  // a cambio de menos contexto. La caché del resumen reduce además el costo
  // de turnos de seguimiento (no recomputamos el DOM si la URL no cambió).
  const EXTERNA_MAX_TEXTO = 2000;
  const EXTERNA_MAX_ENCABEZADOS = 10;
  const EXTERNA_MAX_ELEMENTOS = 30;
  // Tiempo máximo para que el backend devuelva audio TTS antes de caer al
  // fallback de Web Speech. ElevenLabs típicamente entrega en 1-3s; 6s
  // tolera latencia sin dejar al usuario en silencio mucho rato.
  const TTS_BACKEND_TIMEOUT_MS = 6000;
  // Backend local de interpretación con IA. El fetch real vive en
  // background.js (service worker) porque los content scripts no pueden
  // llegar a loopback desde un origen público — Chrome lo bloquea por
  // Local Network Access. Si el backend está apagado o falla, la
  // extensión cae a la heurística local — nunca se rompe.

  const chat = {
    panelAbierto: false,
    mensajes: [],          // solo textos de mensajes del asistente visibles
    busquedaEnCurso: false,
    ultimaConsulta: null,
  };

  function obtenerEstadoInicial() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.mensajes)) {
        return parsed;
      }
    } catch (e) {
      // sessionStorage o JSON corrupto: partimos limpio.
    }
    return null;
  }

  function guardarEstadoChat() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
    } catch (e) {
      // sessionStorage puede no estar disponible (contextos restringidos).
    }
  }

  function obtenerPreferenciaVoz() {
    try {
      const v = localStorage.getItem(VOZ_KEY);
      if (v === null) return true; // default: voz activada
      return v === "true";
    } catch (e) {
      return true;
    }
  }

  function guardarPreferenciaVoz(valor) {
    try {
      localStorage.setItem(VOZ_KEY, valor ? "true" : "false");
    } catch (e) {
      // localStorage puede no estar disponible; mantenemos preferencia en memoria.
    }
  }

  function obtenerPreferenciaModoEscucha() {
    try {
      const v = localStorage.getItem(MODO_ESCUCHA_KEY);
      if (v === null) return true; // default: modo escucha activado
      return v === "true";
    } catch (e) {
      return true;
    }
  }

  function guardarPreferenciaModoEscucha(valor) {
    try {
      localStorage.setItem(MODO_ESCUCHA_KEY, valor ? "true" : "false");
    } catch (e) {}
  }

  // Estado en memoria. vozActivada arranca desde localStorage; los flags de
  // saludo y "ya avisé que no hay soporte" viven solo en esta carga de página.
  let vozActivada = obtenerPreferenciaVoz();
  let saludoLeidoEnEstaSesion = false;
  // True solo en esta carga: la pestaña fue abierta por Iky desde otra
  // pestaña, así que apagamos voz y mic para no contestar dos veces.
  // No se persiste; recargar la página vuelve al comportamiento normal.
  let _silenciadoPorOrigen = false;

  // Estado de reproducción ElevenLabs. Las URLs de objeto se revocan al
  // terminar/error para no filtrar memoria. No se persiste: cada carga
  // de página parte sin audio en curso.
  let audioElevenLabs = null;
  let audioElevenLabsObjectURL = null;
  let audioElevenLabsReproduciendo = false;

  // Medición de "voz silenciosa": contadores en memoria (no se persisten) para
  // cuantificar audio de ElevenLabs que se cobra pero no suena. Solo activos con
  // AG_DEBUG_PERF; el usuario filtra "[Iky][perf] tts_contadores" en la consola y
  // la última línea muestra el total de la sesión.
  //   elevenCobrado  : ElevenLabs devolvió audio (= caracteres facturados)
  //   elevenSono     : ese audio efectivamente se reprodujo (audio.onplay)
  //   elevenCancelado: se cortó antes de terminar (mensaje encadenado lo pisó)
  //   autoplayBloqueado: play() rechazado (cobrado pero el navegador no lo dejó sonar)
  //   webspeech      : se usó el fallback gratuito Web Speech
  const _ttsStats = {
    solicitado: 0,
    elevenCobrado: 0,
    elevenSono: 0,
    elevenCancelado: 0,
    autoplayBloqueado: 0,
    webspeech: 0,
    caracteresCobrados: 0,
  };
  function _ttsBump(updates) {
    if (!AG_DEBUG_PERF) return;
    for (const k in updates) _ttsStats[k] += updates[k];
    perfLog("tts_contadores", { ..._ttsStats });
  }

  // Ventana conversacional del modo escucha: tras una frase válida iniciada
  // con palabra clave, el usuario puede seguir hablando sin repetir "Iky"
  // durante VENTANA_CONVERSACION_MS. La ventana se renueva con cada turno
  // y se cierra al desactivar modo escucha, cerrar panel o reiniciar ayuda.
  // No se persiste: solo memoria.
  const VENTANA_CONVERSACION_MS = 20000;
  let conversacionActivaHasta = 0;
  let ventanaConversacionTimer = null;

  // Estado conversacional: si hay una acción a la que el usuario puede
  // responder por voz/texto (sí/no/búscalo/etc), aquí queda registrada.
  // No se persiste: las confirmaciones activas no sobreviven a navegación
  // ni recarga de página.
  // Tipos: BUSCAR_AHORA | ABRIR_PRIMER_RESULTADO.
  // Política de riesgo: BAJO ejecuta directo (sin estado), MEDIO pasa por
  // estos dos estados (una sola confirmación), ALTO bloquea con mensaje seguro.
  let accionPendiente = null;

  function setAccionPendiente(accion) {
    accionPendiente = accion;
    console.debug("[Asistente] acción pendiente:", accionPendiente);
  }

  function clearAccionPendiente() {
    if (accionPendiente !== null) {
      accionPendiente = null;
      console.debug("[Asistente] acción pendiente:", accionPendiente);
    }
  }

  // Frases explícitas de orientación. Se comparan contra el texto ya
  // normalizado (sin tildes), así que aquí van también sin tildes.
  const PREGUNTAS_ORIENTACION = [
    "donde busco",
    "donde escribo",
    "donde esta la barra",
    "cual es la barra",
  ];

  // Preguntas sobre resultados. Se comparan contra texto normalizado.
  // Este conjunto solo se usa como FALLBACK cuando el backend de IA está
  // caído o devuelve algo inválido. La fuente principal sigue siendo la IA,
  // que ahora también usa contexto.estaEnResultados para desambiguar.
  // Variantes cortas como "que hago" o "y ahora" están aquí a propósito
  // para cubrir lenguaje natural de adultos mayores en resultados.
  const PREGUNTAS_RESULTADOS = [
    "que son estos resultados",
    "no entiendo los resultados",
    "explicame los resultados",
    "que hago ahora",
    "ahora que hago",
    "y ahora",
    "que hago",
    "que deberia hacer",
    "que miro",
    "cual abro",
    "cual deberia abrir",
    "que resultado abro",
  ];

  // Prefijos de intención de búsqueda. Listados de más largo a más corto
  // para que un prefijo más específico gane antes que uno corto que sea
  // su sub-secuencia (ej: "quiero buscar una" antes que "quiero buscar").
  const PREFIJOS_BUSQUEDA = [
    ["ayudame", "a", "buscar"],
    ["quiero", "buscar", "una"],
    ["quiero", "buscar", "un"],
    ["quiero", "aprender", "a"],
    ["quiero", "buscar"],
    ["quiero", "aprender"],
    ["necesito", "encontrar"],
    ["quiero", "encontrar"],
    ["necesito", "saber"],
    ["quiero", "saber"],
    ["buscar"],
    ["busca"],
  ];

  function normalizar(texto) {
    return (texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function limpiarEspacios(texto) {
    return (texto || "").replace(/\s+/g, " ").trim();
  }

  function extraerConsultaBusqueda(textoOriginal) {
    const original = limpiarEspacios(textoOriginal);
    if (!original) return null;

    const palabrasOriginal = original.split(" ");
    const palabrasNorm = palabrasOriginal.map((p) => normalizar(p));

    for (const prefijo of PREFIJOS_BUSQUEDA) {
      if (palabrasNorm.length <= prefijo.length) continue;
      let coincide = true;
      for (let i = 0; i < prefijo.length; i++) {
        if (palabrasNorm[i] !== prefijo[i]) {
          coincide = false;
          break;
        }
      }
      if (coincide) {
        const cola = limpiarEspacios(palabrasOriginal.slice(prefijo.length).join(" "));
        return cola.length > 0 ? cola : null;
      }
    }
    return null;
  }

  // Heurística local. NO es la fuente principal de interpretación — se usa
  // SOLO como fallback cuando el backend de IA está caído, lento, o devuelve
  // algo inválido. La fuente principal es interpretarPrincipal() → backend.
  function interpretarLocal(texto) {
    const t = normalizar(texto);
    if (!t) return { tipo: "DESCONOCIDO" };

    // 1) Preguntas explícitas de orientación ganan siempre.
    for (const frase of PREGUNTAS_ORIENTACION) {
      if (t.includes(frase)) return { tipo: "RESALTAR_BARRA" };
    }

    // 2) Intención de búsqueda (prefijo + cola). Va antes de resultados para
    //    que "quiero buscar que hago ahora" se resuelva como búsqueda, no orientación.
    const consulta = extraerConsultaBusqueda(texto);
    if (consulta) return { tipo: "RESALTAR_CON_CONSULTA", consulta };

    // 3) Preguntas sobre resultados.
    for (const frase of PREGUNTAS_RESULTADOS) {
      if (t.includes(frase)) return { tipo: "EXPLICAR_RESULTADOS" };
    }

    // 4) Fallback puntual: "barra" sola es probablemente orientación.
    if (t === "barra" || t === "la barra") return { tipo: "RESALTAR_BARRA" };

    return { tipo: "DESCONOCIDO" };
  }

  // ---- Interpretación con IA (con fallback a heurística local) ----

  // Conjunto cerrado de intenciones que el backend puede devolver. Cualquier
  // otra cosa se trata como respuesta inválida → fallback local.
  const TIPOS_VALIDOS_IA = new Set([
    "RESALTAR_BARRA",
    "GUIAR_BUSQUEDA",
    "EXPLICAR_RESULTADOS",
    "ABRIR_PRIMER_RESULTADO_SOLICITADO",
    "DESCONOCIDO",
  ]);

  function respuestaValida(r) {
    if (!r || typeof r !== "object") return false;
    if (!TIPOS_VALIDOS_IA.has(r.tipo)) return false;
    if (r.tipo === "GUIAR_BUSQUEDA") {
      if (typeof r.consulta !== "string" || !r.consulta.trim()) return false;
    }
    // mensaje es opcional desde el punto de vista del contrato. Si viene mal
    // formado, sanitizarMensajeIA lo descarta y caemos al hardcoded — pero
    // NO rechazamos toda la respuesta, porque la clasificación puede ser válida.
    return true;
  }

  // Defensa en profundidad: el backend ya sanitiza, pero el cliente NO
  // confía ciegamente. Misma lógica que en server.js. Devuelve null si el
  // mensaje no es usable.
  function sanitizarMensajeIA(m) {
    if (typeof m !== "string") return null;
    let s = m.trim();
    if (!s) return null;
    if (/<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b/i.test(s)) {
      return null;
    }
    if (/\bon\w+\s*=/i.test(s)) return null;
    s = s.replace(/[<>]/g, "");
    s = s.replace(/\s+/g, " ").trim();
    if (!s) return null;
    if (s.length > 220) s = s.slice(0, 217).trimEnd() + "...";
    return s;
  }

  // Decide qué texto mostrar: el de la IA si vino limpio Y la intención
  // proviene de IA; en cualquier otro caso, el hardcoded local. Para
  // intenciones internas (clicks de botones del panel) no hay fuente="ia"
  // así que siempre cae al fallback.
  function mensajeParaMostrar(intencion, fallback) {
    if (intencion
        && intencion.fuente === "ia"
        && typeof intencion.mensaje === "string"
        && intencion.mensaje) {
      return intencion.mensaje;
    }
    return fallback;
  }

  // ---- Detección de contexto: Google vs página externa vs página sensible ----

  // Solo el dominio raíz de Google Search en rutas donde el flujo de
  // búsqueda aplica (home, /search, /webhp, /imghp). Otras rutas del
  // mismo host (/maps, /drive, /flights, /shopping) son páginas externas
  // para nosotros porque el flujo Google-Search no aplica ahí.
  function esGoogleSoportado() {
    const h = window.location.hostname;
    const esHost = h === "www.google.com" || h === "google.com"
                || h === "www.google.cl" || h === "google.cl";
    if (!esHost) return false;
    const p = window.location.pathname || "/";
    return p === "/" || p === ""
        || p.startsWith("/search")
        || p === "/webhp"
        || p === "/imghp";
  }

  // Alias retenido para compatibilidad con código existente que ya usa
  // esGoogle(). Sigue la nueva semántica (host + path soportado).
  function esGoogle() {
    return esGoogleSoportado();
  }

  function esPaginaExterna() {
    return !esGoogleSoportado();
  }

  // Lista deliberadamente cauta: si dudamos, tratamos como sensible y NO
  // extraemos DOM. Es defensa adicional al filtro de términos sensibles.
  const DOMINIOS_SENSIBLES = [
    "bancochile", "santander", "bci", "scotiabank", "itau", "bancoestado",
    "paypal", "mercadopago", "webpay", "transbank", "kushki",
    "claveunica.gob", "sii.cl", "previred",
  ];
  const PATHS_SENSIBLES = [
    "/login", "/signin", "/sign-in", "/signup", "/sign-up",
    "/auth/", "/checkout",
  ];

  function esPaginaSensitivaPorUrl() {
    const h = (window.location.hostname || "").toLowerCase();
    if (DOMINIOS_SENSIBLES.some((d) => h.includes(d))) return true;
    const p = (window.location.pathname || "").toLowerCase();
    if (PATHS_SENSIBLES.some((s) => p.includes(s))) return true;
    return false;
  }

  function construirContexto() {
    let urlAnon = "";
    try {
      const u = new URL(window.location.href);
      // No enviamos query string: el "?q=..." podría revelar lo que el
      // usuario está buscando antes de que confirme. Origen + path basta
      // para saber si está en home o en página de resultados.
      urlAnon = u.origin + u.pathname;
    } catch (_) {
      urlAnon = "";
    }
    return {
      url: urlAnon,
      estaEnResultados: estaEnPaginaResultados(),
      hayPrimerResultado: Boolean(encontrarPrimerResultadoConEnlace()),
    };
  }

  function traducirIntencionIA(r) {
    // El backend usa nombres más explícitos; los traducimos al vocabulario
    // interno de ejecutarIntencion() para no tocar el resto del flujo.
    // Adjuntamos el mensaje saneado (o null) para que ejecutarIntencion lo
    // use cuando exista y caiga al hardcoded cuando no.
    const mensaje = sanitizarMensajeIA(r.mensaje);
    if (r.tipo === "GUIAR_BUSQUEDA" && r.consulta) {
      return { tipo: "RESALTAR_CON_CONSULTA", consulta: r.consulta.trim(), mensaje };
    }
    if (r.tipo === "ABRIR_PRIMER_RESULTADO_SOLICITADO") {
      return { tipo: "ABRIR_PRIMER_RESULTADO", mensaje };
    }
    // RESALTAR_BARRA, EXPLICAR_RESULTADOS y DESCONOCIDO usan los mismos nombres.
    return { tipo: r.tipo, mensaje };
  }

  async function llamarBackendInterpretar(texto, contexto) {
    // El fetch real lo hace background.js (service worker). Acá solo
    // mensajeamos. El timeout vive allá.
    perfLog("backend_request_inicio", { endpoint: "/interpretar" });
    const _t = perfNow();
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        tipo: "INTERPRETAR",
        texto,
        contexto,
      });
    } catch (e) {
      perfLog("backend_request_error", { endpoint: "/interpretar", duracionMs: perfDuracion(_t), error: (e && e.name) || "Error" });
      throw e;
    }
    if (!resp || !resp.ok) {
      perfLog("backend_request_error", { endpoint: "/interpretar", duracionMs: perfDuracion(_t), error: "no_ok" });
      throw new Error(
        resp && resp.error ? resp.error : "sin respuesta del service worker"
      );
    }
    perfLog("backend_request_fin", { endpoint: "/interpretar", duracionMs: perfDuracion(_t), ok: true });
    return resp.data;
  }

  // Fuente principal de interpretación. Siempre intenta IA primero; el
  // intérprete local es la red de seguridad cuando algo falla.
  // El campo `fuente` ("ia" | "local") permite tracear desde dónde vino la
  // intención sin afectar la lógica de ejecutarIntencion().
  async function interpretarPrincipal(texto) {
    try {
      const contexto = construirContexto();
      const respuestaIA = await llamarBackendInterpretar(texto, contexto);
      if (respuestaValida(respuestaIA)) {
        return { ...traducirIntencionIA(respuestaIA), fuente: "ia" };
      }
    } catch (_) {
      // Silencio intencional: cualquier fallo (red, timeout, JSON, validación,
      // rate limit) cae al fallback. La extensión sigue 100% funcional.
    }
    return { ...interpretarLocal(texto), fuente: "local" };
  }

  // ---- Clasificación de riesgo (heurística local, sin IA) ----
  //
  // La política es: las acciones que afectan ejecución (escribir, buscar,
  // abrir externos) NO pueden delegar su decisión de seguridad a la IA. El
  // cliente decide localmente con reglas explícitas; el backend bloquea de
  // todas formas como segunda capa.

  function contieneTerminosSensibles(texto) {
    const t = normalizar(texto);
    if (!t) return false;
    for (const frase of TERMINOS_SENSIBLES_FRASES) {
      if (t.includes(frase)) return true;
    }
    for (const palabra of TERMINOS_SENSIBLES_PALABRAS) {
      if (new RegExp("\\b" + palabra + "\\b").test(t)) return true;
    }
    return false;
  }

  // Detecta cuando el usuario, estando en página externa, pide volver a
  // buscar en Google. En vez de improvisar con la IA, respondemos con un
  // mensaje fijo que lo orienta a volver a la pestaña de Google.
  // El cliente NUNCA abre tabs ni navega — solo informa.
  function esSugerenciaVolverAGoogle(texto) {
    const t = normalizar(texto);
    if (!t) return false;
    const PATRONES = [
      // "en google" cubre "busca X en Google" con cualquier término en medio.
      // Solo se evalúa en página externa, donde decir "en google" sugiere
      // que el usuario quiere volver al buscador.
      "en google",
      "vuelva a google",
      "volver a google",
      "ir a google",
      "regresar a google",
      "volvamos a google",
    ];
    return PATRONES.some((p) => t.includes(p));
  }

  function esBusquedaDirecta(texto) {
    let t = normalizar(texto);
    if (!t) return false;
    // Si el usuario tipea (no por voz) puede prefijar con "Iky," o
    // "asistente," — por voz esto ya viene removido. Limpiamos el
    // prefijo para que "Iky, busca X" matchee igual que "busca X".
    for (const kw of AG_PALABRAS_CLAVE_ESCUCHA) {
      const re = new RegExp("^" + kw + "\\b[,\\s]*");
      if (re.test(t)) { t = t.replace(re, ""); break; }
    }
    return VERBOS_BUSQUEDA_DIRECTA.some((v) => t.startsWith(v));
  }

  // Clasifica el riesgo basándose SOLO en el texto del usuario, sin
  // depender de la intención del backend. Se usa como guardrail temprano
  // en manejarPregunta: si el texto trae términos sensibles, bloqueamos
  // y NO consultamos al backend (ahorro de cuota + defensa adicional).
  // Devuelve "ALTO" si detecta términos sensibles, "BAJO" en cualquier
  // otro caso. Para distinguir BAJO/MEDIO ver clasificarRiesgoAccion.
  function clasificarRiesgoTexto(texto) {
    return contieneTerminosSensibles(texto) ? "ALTO" : "BAJO";
  }

  // Devuelve "BAJO" | "MEDIO" | "ALTO". Determinístico: misma entrada,
  // mismo riesgo. Sin llamadas a IA. ALTO siempre gana, sea cual sea la
  // intención clasificada.
  function clasificarRiesgoAccion(intencion, texto) {
    if (contieneTerminosSensibles(texto)) return "ALTO";
    switch (intencion.tipo) {
      case "RESALTAR_BARRA":
      case "EXPLICAR_RESULTADOS":
      case "DESCONOCIDO":
        return "BAJO";
      case "RESALTAR_CON_CONSULTA":
        // "busca X" = el usuario es explícito → ejecuta sin confirmar.
        // "quiero usar X" = intención implícita → confirma una vez.
        return esBusquedaDirecta(texto) ? "BAJO" : "MEDIO";
      case "ABRIR_PRIMER_RESULTADO":
        // Abrir un dominio externo siempre necesita confirmación.
        return "MEDIO";
      default:
        return "MEDIO";
    }
  }

  function esVisible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const estilo = window.getComputedStyle(el);
    if (estilo.display === "none") return false;
    if (estilo.visibility === "hidden") return false;
    if (parseFloat(estilo.opacity) === 0) return false;
    return true;
  }

  function puntuar(el) {
    let p = 0;
    if (el.getAttribute("name") === "q") p += 5;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (aria.includes("buscar") || aria.includes("search")) p += 3;
    const role = el.getAttribute("role");
    if (role === "combobox" || el.type === "search") p += 2;
    const rect = el.getBoundingClientRect();
    if (rect.width > 200) p += 1;
    return p;
  }

  function encontrarBarra() {
    const candidatos = document.querySelectorAll("textarea, input");
    let mejor = null;
    let mejorPuntaje = 0;
    candidatos.forEach((el) => {
      if (!esVisible(el)) return;
      const p = puntuar(el);
      if (p > mejorPuntaje) {
        mejorPuntaje = p;
        mejor = el;
      }
    });
    return mejor;
  }

  function estaEnPaginaResultados() {
    // 1) Chequeo de URL (lo más confiable cuando está disponible).
    const url = new URL(window.location.href);
    if (url.pathname.includes("/search")) return true;
    if (url.searchParams.has("q")) return true;

    // 2) Chequeo de DOM: Google puede renderizar resultados con navegación JS
    //    antes de que la URL refleje "/search".
    const search = document.querySelector("#search");
    if (search && esVisible(search)) return true;

    const rso = document.querySelector("#rso");
    if (rso && esVisible(rso)) return true;

    // 3) Último recurso: al menos un enlace con h3 visible (estructura típica
    //    de resultados orgánicos) presente en la página.
    return Array.from(document.querySelectorAll("a h3")).some((h3) => esVisible(h3));
  }

  function explicarResultados(intencion) {
    if (!estaEnPaginaResultados()) {
      // No usamos mensaje IA: el modelo pudo creer que estaba en resultados
      // por el contexto, pero la verdad la decide el cliente.
      agregarMensaje(RESPUESTA_NO_EN_RESULTADOS);
      return;
    }
    const resultado = encontrarPrimerResultadoConEnlace();
    if (resultado) {
      // Mensaje IA OK: el resultado fue encontrado tal como el contexto indicaba.
      // Fusionamos explicación + pregunta de confirmación en UN solo agregarMensaje
      // para que el TTS lo lea como un único flujo de voz. Antes hacíamos dos
      // agregarMensaje seguidos (uno aquí + otro dentro de mostrarAccionAbrir...)
      // y los audios se superponían cuando ambas requests a ElevenLabs llegaban
      // casi simultáneas.
      const explicacion = mensajeParaMostrar(intencion, RESPUESTA_EXPLICAR_RESULTADOS);
      const yaPregunta = /\?\s*$/.test(explicacion) || /\bquiere\b/i.test(explicacion);
      const mensajeCombinado = yaPregunta
        ? explicacion
        : explicacion + " ¿Lo abro en otra pestaña?";
      agregarMensaje(mensajeCombinado);
      resaltar(resultado.contenedor);
      mostrarAccionAbrirPrimerResultado(resultado);
    } else {
      // No detectamos primer resultado (módulos especiales, layout raro):
      // hardcoded porque el mensaje IA pudo asumir que sí lo había.
      agregarMensaje(
        "Estos son los resultados. Los títulos azules son páginas que puede abrir."
      );
    }
  }

  function encontrarPrimerResultadoConEnlace() {
    // Intentamos acotar la búsqueda al contenedor principal de resultados orgánicos.
    const scope =
      document.querySelector("#search #rso") ||
      document.querySelector("#rso") ||
      document.querySelector("#search") ||
      document.body;

    const enlaces = scope.querySelectorAll("a");
    for (const enlace of enlaces) {
      const h3 = enlace.querySelector("h3");
      if (!h3 || !esVisible(enlace) || !esVisible(h3)) continue;
      const href = enlace.getAttribute("href") || "";
      if (!href) continue;
      if (href.startsWith("javascript:")) continue;
      // Solo enlaces externos (resultados reales), no rutas internas de Google.
      if (!href.startsWith("http") && !href.startsWith("/url")) continue;
      if (/google\.(com|cl)\/search\?/.test(href)) continue;

      // Resolvemos a URL absoluta y desempacamos el redirect /url?q=... que
      // Google usa a veces para resultados orgánicos.
      let url = enlace.href;
      try {
        const u = new URL(url);
        if (u.pathname === "/url" && u.searchParams.has("q")) {
          url = u.searchParams.get("q") || url;
        }
      } catch (e) {
        continue;
      }
      if (!/^https?:\/\//i.test(url)) continue;

      // Subimos al contenedor de la card del resultado para resaltarlo entero.
      const contenedor =
        enlace.closest(".g") ||
        enlace.closest("[data-hveid]") ||
        enlace.parentElement ||
        enlace;
      return { contenedor, enlace, url };
    }
    return null;
  }

  function resaltar(el) {
    document.querySelectorAll(".ag-resaltado").forEach((prev) => {
      prev.classList.remove("ag-resaltado");
    });
    el.classList.add("ag-resaltado");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Guía visual con cursor virtual (HITO 3). Todo resaltado nace de una
    // respuesta de Iky (explicar página / sugerir botón / explicar resultados)
    // o de un comando explícito del usuario en el panel ("¿dónde busco?"), así
    // que basta con exigir que el panel esté abierto. El overlay es
    // pointer-events:none: jamás hace clic ni interactúa. Si el panel está
    // cerrado no guiamos (y limpiamos cualquier cursor que hubiera quedado).
    if (panelEstaAbierto()) {
      mostrarCursorGuiaHaciaElemento(el);
    } else {
      ocultarCursorGuia();
    }
  }

  // ---- Cursor virtual de guía visual (HITO 3) ----
  //
  // Muestra un indicador en overlay que viaja desde la zona del panel hacia el
  // elemento resaltado para señalar dónde mirar / dónde debería pinchar el
  // usuario. REGLAS DURAS: nunca simula clics/teclas/escritura; el overlay es
  // pointer-events:none (no bloquea la página); respeta prefers-reduced-motion
  // (sin animación); modo conservador en páginas sensibles (sin pulso agresivo).

  // Timer único para coordinar el "settle" del scroll y el pulso de llegada.
  let _cursorGuiaTimer = null;

  function prefiereMenosMovimiento() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function cancelarTimersCursor() {
    if (_cursorGuiaTimer) {
      clearTimeout(_cursorGuiaTimer);
      _cursorGuiaTimer = null;
    }
  }

  // Punto desde el que "nace" el cursor: idealmente la zona del panel (borde
  // izquierdo, mirando hacia el contenido de la página). Si el panel no es
  // medible, caemos a la esquina inferior derecha del viewport.
  function puntoOrigenCursor() {
    let x = window.innerWidth - 40;
    let y = window.innerHeight - 40;
    if (panel && !panel.classList.contains("ag-oculto")) {
      const r = panel.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        x = r.left;
        y = r.top + r.height / 2;
      }
    }
    return { x, y };
  }

  function posicionarCursorEn(x, y) {
    cursorGuia.style.transform =
      "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
  }

  // Coloca y anima el cursor hacia el centro de `el`. opciones.conservador
  // fuerza el modo sin animación agresiva (también se activa solo en páginas
  // sensibles). No hace nada si el elemento no es visible.
  function mostrarCursorGuiaHaciaElemento(el, opciones) {
    if (!cursorGuia || !el || !esVisible(el)) return;
    const opts = opciones || {};

    // Re-guiar a un nuevo elemento limpia el estado anterior (timers + clases
    // de halo) antes de empezar.
    cancelarTimersCursor();
    cursorGuia.classList.remove("ag-cursor-pulso", "ag-cursor-estatico");

    const reduce = prefiereMenosMovimiento();
    const conservador = opts.conservador || esPaginaSensitivaPorUrl();
    // reduced-motion o página sensible → halo estático (sin pulso); resto →
    // pulso animado al llegar.
    const claseHalo = (reduce || conservador) ? "ag-cursor-estatico" : "ag-cursor-pulso";

    const origen = puntoOrigenCursor();
    cursorGuia.style.display = "block";
    posicionarCursorEn(origen.x, origen.y);

    const moverADestino = () => {
      _cursorGuiaTimer = null;
      // El elemento pudo desaparecer mientras esperábamos el settle del scroll.
      if (!esVisible(el)) { ocultarCursorGuia(); return; }
      // Antes de fijar el destino del cursor: si el panel tapa el objetivo,
      // compactarlo/reubicarlo para que el elemento quede visible.
      autoCompactarSiTapa(el);
      const r = el.getBoundingClientRect();
      posicionarCursorEn(r.left + r.width / 2, r.top + r.height / 2);
      const activarPulso = () => {
        _cursorGuiaTimer = null;
        cursorGuia.classList.add(claseHalo);
      };
      if (reduce) {
        // Sin animación: halo estático inmediato.
        activarPulso();
      } else {
        // Esperamos a que termine el viaje (transición CSS ~950ms) para pulsar.
        _cursorGuiaTimer = setTimeout(activarPulso, 950);
      }
    };

    if (reduce) {
      // Sin animación de viaje: salto directo al destino tras un settle corto
      // del scroll. La transición CSS ya está anulada por el media query.
      _cursorGuiaTimer = setTimeout(moverADestino, 60);
    } else {
      // Forzamos reflow para que el cambio de transform al destino se anime
      // desde el origen, y esperamos a que el scrollIntoView (smooth) acomode
      // el elemento antes de calcular su posición final.
      void cursorGuia.offsetWidth;
      _cursorGuiaTimer = setTimeout(moverADestino, 420);
    }
  }

  function ocultarCursorGuia() {
    if (!cursorGuia) return;
    cancelarTimersCursor();
    cursorGuia.classList.remove("ag-cursor-pulso", "ag-cursor-estatico");
    cursorGuia.style.display = "none";
  }

  // Punto único de limpieza de TODA la guía visual (resaltado + cursor).
  // Se invoca al cerrar el panel, reiniciar la ayuda y navegar.
  function limpiarGuiasVisuales() {
    document.querySelectorAll(".ag-resaltado").forEach((prev) => {
      prev.classList.remove("ag-resaltado");
    });
    ocultarCursorGuia();
    // Si el panel se compactó automáticamente para la guía, al terminar ésta
    // lo devolvemos a su estado completo. Una compactación manual del usuario
    // se respeta (no la tocamos).
    if (_compactoAuto) {
      setCompacto(false);
      _compactoAuto = false;
    }
  }

  // ---- Modo compacto del panel (HITO: responsivo) ----
  //
  // El panel completo (bottom-right) puede tapar el elemento que estamos
  // guiando. setCompacto reduce el panel a una barra (header + estado mic);
  // autoCompactarSiTapa decide en runtime si compactar/reubicar según haya
  // intersección entre el rect del panel y el del objetivo.

  let _compactoAuto = false;       // true si la compactación fue automática
  let _controlManualTs = 0;        // timestamp del último toggle manual
  const RESPETAR_CONTROL_MANUAL_MS = 8000;

  function setCompacto(compacto) {
    panel.classList.toggle("ag-panel-compacto", compacto);
    // La reposición a la izquierda solo tiene sentido estando compacto.
    if (!compacto) panel.classList.remove("ag-panel-izquierda");
    btnMinimizar.textContent = compacto ? "Expandir" : "Minimizar";
    btnMinimizar.setAttribute("aria-label", compacto ? "Expandir el panel" : "Minimizar el panel");
    btnMinimizar.setAttribute("aria-expanded", compacto ? "false" : "true");
  }

  function rectsIntersectan(a, b) {
    return !(a.right <= b.left || a.left >= b.right ||
             a.bottom <= b.top || a.top >= b.bottom);
  }

  // Compacta/reubica el panel si tapa al elemento objetivo. Respeta una
  // expansión manual reciente del usuario. No hace nada si el panel está
  // oculto o el elemento no tiene caja.
  function autoCompactarSiTapa(el) {
    if (!el || !panel || panel.classList.contains("ag-oculto")) return;
    if (Date.now() - _controlManualTs < RESPETAR_CONTROL_MANUAL_MS) return;
    const elRect = el.getBoundingClientRect();
    if (!elRect.width || !elRect.height) return;

    // Medimos con el panel EXPANDIDO y en su posición natural como referencia.
    // (Toggle de clase + lectura de rect en el mismo tick: sin repintado/flash.)
    setCompacto(false);
    if (!rectsIntersectan(panel.getBoundingClientRect(), elRect)) {
      _compactoAuto = false;
      return; // expandido no tapa: dejamos el panel completo
    }

    // Expandido tapa el objetivo: compactamos.
    setCompacto(true);
    _compactoAuto = true;

    // En pantallas angostas el panel es full-width: reubicar a la izquierda no
    // ayuda. La barra compacta abajo ya despeja el objetivo centrado.
    if (window.innerWidth <= 520) return;

    if (rectsIntersectan(panel.getBoundingClientRect(), elRect)) {
      // Compacto y aún tapa: probamos reubicar a la izquierda.
      panel.classList.add("ag-panel-izquierda");
      if (rectsIntersectan(panel.getBoundingClientRect(), elRect)) {
        // A la izquierda tampoco despeja (objetivo a la izquierda): no empeorar,
        // volvemos a la derecha.
        panel.classList.remove("ag-panel-izquierda");
      }
    }
  }

  function renderMensaje(texto) {
    const p = document.createElement("p");
    p.className = "ag-mensaje";
    p.textContent = texto;
    mensajes.appendChild(p);
    panel.scrollTop = panel.scrollHeight;
  }

  function agregarMensaje(texto, opciones) {
    const opts = opciones || {};
    chat.mensajes.push(texto);
    renderMensaje(texto);
    guardarEstadoChat();
    perfLog("mensaje_mostrado", {
      textoLength: texto.length,
      duracionDesdePreguntaMs: _perfPreguntaInicio ? perfDuracion(_perfPreguntaInicio) : null,
    });
    // Auto-lectura: salvo opt-out explícito (ej: avisos del propio TTS), si la
    // preferencia está en true y el navegador soporta voz, leemos el nuevo
    // mensaje. leerTexto() cancela cualquier utterance previa, así que dos
    // mensajes seguidos no se encimar.
    if (opts.leer === false) return;
    if (vozActivada && speechDisponible()) {
      leerTexto(texto);
    }
  }

  // ---- Chat de página externa (HITO 2B) ----
  //
  // En páginas que NO son Google Search, Iky actúa como chat contextual:
  // describe la página y opcionalmente resalta un elemento. Cero
  // interacción: no clicks, no escritura, no submits, no apertura.
  //
  // Privacidad: solo enviamos un RESUMEN del DOM (no HTML literal). Sin
  // values, sin passwords, sin cookies, sin localStorage, sin query.

  const _elementosResaltablesMap = new Map(); // idx → Element

  // ---- Memoria conversacional del chat de página externa ----
  //
  // chatPagina vive en memoria + sessionStorage (por pestaña). Solo
  // {urlKey, historial}. NUNCA guardamos el resumen del DOM ni el
  // textoVisible — eso se recalcula o se cachea en memoria. Si la URL
  // cambia (navegación SPA / nueva pestaña), el historial se resetea
  // porque ya no es relevante para la página nueva.
  let chatPagina = obtenerChatPaginaInicial();
  // Caché del resumen del DOM. Permite que turnos de seguimiento no
  // recomputen el resumen completo (ahorra latencia y tokens).
  let ultimoResumenPagina = null;
  let ultimoUrlKey = null;

  function obtenerUrlKeyActual() {
    return window.location.origin + window.location.pathname;
  }

  function obtenerChatPaginaInicial() {
    try {
      const raw = sessionStorage.getItem(CHAT_PAGINA_KEY);
      if (!raw) return { urlKey: null, historial: [] };
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.historial)) {
        return {
          urlKey: typeof parsed.urlKey === "string" ? parsed.urlKey : null,
          historial: parsed.historial
            .filter((t) => t && typeof t === "object"
                        && (t.rol === "usuario" || t.rol === "asistente")
                        && typeof t.texto === "string")
            .slice(-HISTORIAL_CHAT_MAX),
        };
      }
    } catch (e) {}
    return { urlKey: null, historial: [] };
  }

  function guardarChatPagina() {
    try {
      sessionStorage.setItem(CHAT_PAGINA_KEY, JSON.stringify({
        urlKey: chatPagina.urlKey,
        historial: chatPagina.historial.slice(-HISTORIAL_CHAT_MAX),
      }));
    } catch (e) {}
  }

  // Si la URL cambió desde la última vez (navegación SPA o pestaña
  // distinta), el historial previo ya no es relevante. Resetea + persiste.
  function asegurarHistorialPaginaActual() {
    const urlKey = obtenerUrlKeyActual();
    if (chatPagina.urlKey !== urlKey) {
      chatPagina = { urlKey, historial: [] };
      guardarChatPagina();
    }
  }

  function agregarTurnoChat(rol, texto) {
    if (!texto || typeof texto !== "string") return;
    const t = texto.slice(0, 400); // cap defensivo, igual al cap de mensaje IA
    chatPagina.historial.push({ rol, texto: t });
    if (chatPagina.historial.length > HISTORIAL_CHAT_MAX) {
      chatPagina.historial = chatPagina.historial.slice(-HISTORIAL_CHAT_MAX);
    }
    guardarChatPagina();
  }

  function obtenerHistorialReciente() {
    // Últimos N turnos para enviar al backend.
    return chatPagina.historial.slice(-HISTORIAL_BACKEND_MAX);
  }

  // Devuelve el resumen del DOM, usando caché si la URL no cambió y no
  // se fuerza recálculo. Reconstruye _elementosResaltablesMap cada vez
  // que recalcula (ese map vive en memoria, no se persiste).
  function obtenerResumenCacheadoOFresco(forzar) {
    const urlKey = obtenerUrlKeyActual();
    if (forzar || urlKey !== ultimoUrlKey || !ultimoResumenPagina) {
      ultimoResumenPagina = construirResumenPaginaExterna();
      ultimoUrlKey = urlKey;
    }
    return ultimoResumenPagina;
  }

  // Detector simple de pregunta de seguimiento. NO decide acciones; lo
  // usamos para logging y para tener un punto explícito si en el futuro
  // queremos cambiar comportamiento (ej: enviar más historial para
  // seguimientos). Hoy el historial se envía siempre que exista.
  function esPreguntaDeSeguimiento(textoNormalizado) {
    if (!textoNormalizado) return false;
    const FRASES = [
      "y ahora", "que hago", "donde", "cual",
      "ese", "eso", "ahi", "repitelo", "no entendi",
    ];
    return FRASES.some((f) => textoNormalizado.includes(f));
  }

  // Detector de comando "actualiza" / "relee" / "vuelve a mirar". Si
  // matchea, forzamos reconstrucción del resumen del DOM (caché stale).
  function esComandoActualizar(textoNormalizado) {
    if (!textoNormalizado) return false;
    const FRASES = [
      "actualiza", "actualizalo", "actualizame",
      "relee", "relee la pagina", "relela",
      "vuelve a mirar", "vuelva a mirar",
      "vuelve a ver", "mira de nuevo",
    ];
    return FRASES.some((f) => textoNormalizado.includes(f));
  }

  // Variante: ¿el texto es SOLO el comando, sin otra pregunta? Si sí,
  // respondemos local con un mensaje neutral en vez de llamar al backend.
  function esSoloComandoActualizar(textoNormalizado) {
    if (!textoNormalizado) return false;
    const PUROS = [
      "actualiza", "actualizalo", "actualizame",
      "relee", "relela", "relee la pagina", "relee esta pagina",
      "vuelve a mirar", "vuelva a mirar",
      "vuelve a mirar la pagina", "vuelva a mirar la pagina",
      "actualiza la pagina", "actualizame la pagina",
      "mira de nuevo", "vuelve a ver",
    ];
    return PUROS.includes(textoNormalizado);
  }

  function esCampoSensiblePagina(el) {
    if (el.tagName === "INPUT") {
      const t = (el.type || "").toLowerCase();
      if (t === "password" || t === "hidden") return true;
      const ac = (el.autocomplete || "").toLowerCase();
      if (ac.includes("cc-") || ac === "current-password" || ac === "new-password") return true;
    }
    const name = (el.getAttribute("name") || "").toLowerCase();
    if (/pass|password|clave|contrase|cvv|tarjeta|card/.test(name)) return true;
    return false;
  }

  function identificarTipoElementoPagina(el) {
    if (el.tagName === "A") return "link";
    if (el.tagName === "BUTTON") return "button";
    if (el.getAttribute("role") === "button") return "button";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      return "input";
    }
    return "other";
  }

  // Campos descriptivos seguros del elemento. NUNCA leemos .value — aunque
  // sea un input inocente, su contenido puede traer datos personales.
  // Devolvemos los campos por separado (texto/ariaLabel/placeholder/tag/rol)
  // para que el modelo pueda distinguir mejor entre elementos similares.
  function obtenerCamposSegurosPagina(el) {
    const texto = (el.textContent || "").replace(/\s+/g, " ").trim();
    const aria = (el.getAttribute("aria-label") || "").trim();
    const ph = (el.getAttribute("placeholder") || "").trim();
    return {
      texto: texto ? texto.slice(0, 80) : null,
      ariaLabel: aria ? aria.slice(0, 80) : null,
      placeholder: ph ? ph.slice(0, 80) : null,
      tag: el.tagName,
      rol: el.getAttribute("role") || null,
    };
  }

  // Posición/tamaño del elemento en el viewport. Solo geometría (no PII):
  // se usa para el ranking local del HITO 2F. El backend la ignora
  // (sanearPaginaPayload no la lee), así que nunca llega al modelo.
  function rectDeElemento(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  }

  function construirResumenPaginaExterna() {
    _elementosResaltablesMap.clear();

    const titulo = (document.title || "").trim().slice(0, 200);

    const encabezados = [];
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      if (!esVisible(h)) continue;
      const txt = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (txt) encabezados.push(txt.slice(0, 120));
      if (encabezados.length >= EXTERNA_MAX_ENCABEZADOS) break;
    }

    // body.innerText respeta CSS de visibilidad (no incluye display:none
    // ni visibility:hidden). Reemplazamos saltos y cortamos al cap nuevo
    // del HITO 2E (2000) para reducir tokens en turnos de seguimiento.
    const rawTexto = (document.body && document.body.innerText) || "";
    const textoVisible = rawTexto.replace(/\s+/g, " ").trim().slice(0, EXTERNA_MAX_TEXTO);

    const selector = 'button, a[href], input, textarea, select, [role="button"], [aria-label]';
    const elementos = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!esVisible(el)) continue;
      if (esCampoSensiblePagina(el)) continue;
      const campos = obtenerCamposSegurosPagina(el);
      // Solo incluimos el elemento si tiene algún descriptor útil; si no,
      // el modelo no podría referirse a él de forma significativa.
      if (!campos.texto && !campos.ariaLabel && !campos.placeholder) continue;
      const idx = elementos.length;
      elementos.push({
        idx,
        tipo: identificarTipoElementoPagina(el),
        texto: campos.texto,
        ariaLabel: campos.ariaLabel,
        placeholder: campos.placeholder,
        tag: campos.tag,
        rol: campos.rol,
        // HITO 2F: geometría para el ranking local (no se envía al modelo).
        rect: rectDeElemento(el),
      });
      _elementosResaltablesMap.set(idx, el);
      if (elementos.length >= EXTERNA_MAX_ELEMENTOS) break;
    }

    return {
      // Sin query string ni fragment para no filtrar parámetros sensibles.
      url: window.location.origin + window.location.pathname,
      titulo,
      encabezados,
      textoVisible,
      elementos,
      // HITO 2F: tamaño del viewport para heurísticas de posición.
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  }

  // Resalta visualmente el elemento externo cuyo idx fue devuelto por la
  // IA. Solo marca con .ag-resaltado + scrollIntoView. NUNCA hace .click()
  // ni dispara eventos. Devuelve true si resaltó, false si el idx no es
  // válido o el elemento ya no está visible.
  function resaltarElementoExternoPorIdx(idx) {
    if (!Number.isInteger(idx) || idx < 0) return false;
    const el = _elementosResaltablesMap.get(idx);
    if (!el || !esVisible(el)) return false;
    perfLog("guia_visual_inicio", { idx });
    const _tGuia = perfNow();
    resaltar(el);
    perfLog("guia_visual_fin", {
      duracionMs: perfDuracion(_tGuia),
      cursor: panelEstaAbierto(),
      compacto: panel.classList.contains("ag-panel-compacto"),
    });
    return true;
  }

  // ====================================================================
  // HITO 2F — Guía visual inteligente en páginas externas
  //
  // Para intents comunes (login, continuar, aceptar cookies, cerrar,
  // menú, buscar) resolvemos de forma DETERMINÍSTICA en el cliente:
  // clasificamos el intent, rankeamos los elementos del resumen ya
  // cacheado y, si hay evidencia suficiente, resaltamos sin llamar al
  // backend. Solo si la confianza es baja caemos a /explicar-pagina,
  // adjuntando los mejores candidatos para que el modelo elija entre
  // pocos en vez de adivinar entre 30.
  //
  // REGLAS DURAS heredadas: cero interacción (no click, no escritura),
  // solo elementos visibles, jamás proponemos elementos de pago/banco.
  // ====================================================================

  const GUIA_INTENT = {
    LOGIN: "LOGIN",
    CONTINUAR: "CONTINUAR",
    ACEPTAR_COOKIES: "ACEPTAR_COOKIES",
    CERRAR_POPUP: "CERRAR_POPUP",
    MENU: "MENU",
    BUSCAR_EN_PAGINA: "BUSCAR_EN_PAGINA",
  };

  // Umbrales de confianza del ranking (score 0..100).
  //   >= 60  → alta:  resolver local con mensaje directo.
  //   40..59 → media: resolver local con mensaje de incertidumbre ("Creo que…").
  //   < 40   → baja:  fallback a /explicar-pagina (IA) con candidatos.
  const UMBRAL_GUIA_ALTA = 60;
  const UMBRAL_GUIA_MEDIA = 40;

  // Definición por intent: frases exactas (+50), keywords (+35) y
  // equivalentes en inglés (+35). El texto del elemento se normaliza
  // (minúsculas, sin tildes) antes del match.
  const GUIA_DEFS = {
    LOGIN: {
      frases: ["iniciar sesion", "inicia sesion", "ingresar a mi cuenta"],
      keywords: ["sesion", "ingresar", "ingresa", "acceder", "entrar"],
      english: ["sign in", "log in", "login", "signin", "sign-in", "log-in"],
    },
    CONTINUAR: {
      frases: ["continuar sin cuenta", "continuar como invitado"],
      keywords: ["continuar", "continua", "siguiente", "seguir", "avanzar"],
      english: ["continue", "next"],
    },
    ACEPTAR_COOKIES: {
      frases: ["aceptar cookies", "aceptar todas", "aceptar todo", "aceptar y cerrar", "acepto las cookies"],
      keywords: ["aceptar", "acepto", "acepta", "consentir", "consentimiento"],
      english: ["accept all", "i agree", "accept", "agree", "consent", "allow"],
    },
    CERRAR_POPUP: {
      frases: ["cerrar ventana", "cerrar aviso", "cerrar este mensaje"],
      keywords: ["cerrar", "cierra", "cerrarlo"],
      english: ["close", "dismiss"],
    },
    MENU: {
      frases: ["menu de navegacion", "abrir menu"],
      keywords: ["menu", "navegacion", "hamburguesa", "opciones"],
      english: ["open menu", "menu", "navigation"],
    },
    BUSCAR_EN_PAGINA: {
      frases: ["barra de busqueda", "caja de busqueda", "cuadro de busqueda"],
      keywords: ["buscar", "busqueda", "busca"],
      english: ["search", "find"],
    },
  };

  // Mensaje en confianza alta por intent (texto simple, sin inventar).
  const GUIA_MENSAJE_ALTA = {
    LOGIN: "Le marqué el botón para iniciar sesión.",
    CONTINUAR: "Le marqué el botón para continuar.",
    ACEPTAR_COOKIES: "Le marqué el botón para aceptar cookies.",
    CERRAR_POPUP: "Le marqué el botón para cerrar.",
    MENU: "Le marqué el menú.",
    BUSCAR_EN_PAGINA: "Le marqué la caja para buscar en la página.",
  };
  const GUIA_MENSAJE_MEDIA =
    "Creo que sería este. Si no, avíseme.";

  // Texto de elemento que NUNCA debemos proponer como destino de guía:
  // aunque el intent sea inocente, no marcamos botones de pago/banco/clave.
  const GUIA_ELEMENTO_BLOQUEADO =
    /\b(pagar|pago|pagos|paga|pague|checkout|comprar|compra|compralo|banco|bancaria|bancario|tarjeta|transferir|transferencia|cvv|clave|contrasena|password)\b/;

  function _matchPalabraGuia(hay, palabra) {
    return new RegExp(
      "\\b" + palabra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"
    ).test(hay);
  }

  // Clasificador local de intent de guía. Recibe texto YA normalizado.
  // Devuelve un GUIA_INTENT o null. No sobre-ingenieriza: cubre lo obvio
  // en español (y algunos equivalentes en inglés). El primer match gana.
  function detectarIntentGuiaExterna(t) {
    if (!t) return null;
    // LOGIN — excluye "cerrar sesión" / "salir de la cuenta" (eso es logout).
    if (
      (/\b(iniciar sesion|inicia sesion)\b/.test(t)
        || /\b(ingresar|ingreso|ingresa|acceder|accedo|entrar|entro|loguear|logear)\b/.test(t)
        || /\b(sign in|log in|login|signin)\b/.test(t))
      && !/cerrar sesion|salir de (la|mi) cuenta/.test(t)
    ) {
      return GUIA_INTENT.LOGIN;
    }
    // CONTINUAR
    if (
      /\b(continuar|continua|continuo|sigo|siguiente|avanzar|proceder)\b/.test(t)
      || /\bcomo sigo\b/.test(t) || /\bnext\b/.test(t)
    ) {
      return GUIA_INTENT.CONTINUAR;
    }
    // ACEPTAR_COOKIES
    if (
      /\bcookies?\b/.test(t)
      || /\b(consent|consentimiento|consentir)\b/.test(t)
      || /\b(aceptar|acepto|acepta)\b/.test(t)
      || /\b(agree|allow)\b/.test(t)
    ) {
      return GUIA_INTENT.ACEPTAR_COOKIES;
    }
    // CERRAR_POPUP — excluye "cerrar sesión".
    if (
      (/\b(cerrar|cierra|cierro|cerrarlo)\b/.test(t) || /\b(close|dismiss)\b/.test(t)
        || /quitar (este|el|esta|la) (aviso|mensaje|cartel|popup|ventana|publicidad)/.test(t))
      && !/cerrar sesion/.test(t)
    ) {
      return GUIA_INTENT.CERRAR_POPUP;
    }
    // MENU
    if (/\b(menu|menus|hamburguesa|navegacion)\b/.test(t)) {
      return GUIA_INTENT.MENU;
    }
    // BUSCAR_EN_PAGINA (deliberadamente estrecho: no captura "busca X").
    // El buscador en sí: "barra/caja/cuadro de búsqueda", "buscar en la página".
    if (/buscar en (la|esta) pagina|caja de busqueda|barra de busqueda|cuadro de busqueda/.test(t)) {
      return GUIA_INTENT.BUSCAR_EN_PAGINA;
    }
    // "dónde busco" / "dónde puedo buscar": solo marcamos el buscador si la
    // frase termina ahí o sigue con relleno genérico. Si viene un objeto
    // específico ("dónde puedo buscar devoluciones / mi pedido"), NO es el
    // buscador: devolvemos null para que lo resuelva el asistente (backend),
    // que sí entiende a qué sección se refiere.
    const mBuscar = t.match(/\bdonde (?:busco|puedo buscar)\b(.*)$/);
    if (mBuscar) {
      const resto = mBuscar[1].trim();
      if (resto === "" || /^(algo|cosas?|informacion|aqui|por aqui|en (la|esta) pagina|en el sitio)\b/.test(resto)) {
        return GUIA_INTENT.BUSCAR_EN_PAGINA;
      }
    }
    return null;
  }

  function _textoElementoGuia(el) {
    return normalizar(
      [el.texto, el.ariaLabel, el.placeholder].filter(Boolean).join(" ")
    );
  }

  // Puntúa UN elemento del resumen para un intent. Sumas simples sobre
  // 0..100. Devuelve {score, bloqueado, matchTexto, razon}. matchTexto
  // indica si el texto del elemento tuvo alguna relación con el intent;
  // sin eso no es candidato (evita proponer botones al azar).
  function puntuarElementoGuia(intent, el, vw, vh) {
    const def = GUIA_DEFS[intent];
    const hay = _textoElementoGuia(el);

    // Seguridad: jamás proponemos pago/banco/clave, matchee o no el intent.
    if (GUIA_ELEMENTO_BLOQUEADO.test(hay)) {
      return { score: 0, bloqueado: true, matchTexto: false, razon: "elemento sensible: no se propone" };
    }

    let score = 0;
    const razones = [];

    // 1) Match de texto — el nivel más fuerte de los tres (sin doble conteo:
    //    "iniciar sesion" no suma además por la keyword "sesion").
    let textoScore = 0;
    let textoRazon = "";
    for (const f of def.frases) {
      if (hay.includes(f) && 50 > textoScore) { textoScore = 50; textoRazon = 'coincide con "' + f + '"'; }
    }
    if (textoScore < 50) {
      for (const k of def.keywords) {
        if (_matchPalabraGuia(hay, k) && 35 > textoScore) { textoScore = 35; textoRazon = 'menciona "' + k + '"'; }
      }
      for (const e of def.english) {
        if (hay.includes(e) && 35 > textoScore) { textoScore = 35; textoRazon = 'coincide con "' + e + '"'; }
      }
    }
    score += textoScore;
    if (textoRazon) razones.push(textoRazon);

    // 2) Tipo / rol.
    const esBoton = el.tipo === "button" || el.rol === "button";
    const esLink = el.tipo === "link";
    if (esBoton) { score += 10; razones.push("es botón"); }
    else if (esLink) { score += 6; razones.push("es enlace"); }
    if (intent === GUIA_INTENT.BUSCAR_EN_PAGINA
        && (el.tipo === "input" || el.rol === "searchbox")) {
      score += 10; razones.push("es caja de texto");
    }

    // 3) Posición (heurística suave, no rígida).
    const r = el.rect || {};
    const x = typeof r.x === "number" ? r.x : 0;
    const y = typeof r.y === "number" ? r.y : 0;
    if (intent === GUIA_INTENT.LOGIN && y < 200 && x > vw * 0.55) {
      score += 6; razones.push("arriba a la derecha");
    } else if (intent === GUIA_INTENT.ACEPTAR_COOKIES && y > vh * 0.6) {
      score += 6; razones.push("abajo");
    } else if (intent === GUIA_INTENT.MENU && y < 200 && x < vw * 0.45) {
      score += 6; razones.push("arriba a la izquierda");
    }

    // 4) Tamaño visible razonable (no minúsculo).
    const w = typeof r.w === "number" ? r.w : 0;
    const h = typeof r.h === "number" ? r.h : 0;
    if (w >= 40 && h >= 20) { score += 5; razones.push("tamaño visible"); }

    if (score > 100) score = 100;
    return { score, bloqueado: false, matchTexto: textoScore > 0, razon: razones.join(", ") };
  }

  // Rankea los elementos del resumen para un intent. Devuelve un arreglo
  // {idx, score, razon} ordenado por score desc. El mejor candidato es
  // `[0]`. Solo incluye elementos con relación de texto al intent y nunca
  // elementos sensibles (pago/banco).
  function rankearElementosParaIntent(intent, elementos, viewport) {
    if (!GUIA_DEFS[intent] || !Array.isArray(elementos)) return [];
    const vw = (viewport && typeof viewport.w === "number") ? viewport.w : 1000;
    const vh = (viewport && typeof viewport.h === "number") ? viewport.h : 800;
    const out = [];
    for (const el of elementos) {
      const r = puntuarElementoGuia(intent, el, vw, vh);
      if (r.bloqueado || !r.matchTexto || r.score <= 0) continue;
      out.push({ idx: el.idx, score: r.score, razon: r.razon });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // ---- Estado de la última guía local (para "no es ese") ----
  let _guiaUrlKey = null;
  let _guiaIntent = null;
  let _guiaCandidatos = []; // [{idx,score,razon}] del último ranking local
  let _guiaPos = -1;        // posición dentro de _guiaCandidatos del resaltado actual
  let _guiaTextoOriginal = null; // pregunta que originó la guía (para reconsultar al backend en "no es ese")

  function _resetGuiaSiCambioUrl() {
    const k = obtenerUrlKeyActual();
    if (k !== _guiaUrlKey) {
      _guiaUrlKey = k;
      _guiaIntent = null;
      _guiaCandidatos = [];
      _guiaPos = -1;
      _guiaTextoOriginal = null;
    }
  }

  // Resuelve una guía localmente (sin backend): marca el mejor candidato,
  // guarda el ranking para correcciones y registra el turno en memoria.
  function resolverGuiaLocal(intent, ranking, confianza, textoUsuario) {
    _guiaIntent = intent;
    _guiaCandidatos = ranking.slice(0, 5);
    _guiaPos = 0;
    _guiaTextoOriginal = textoUsuario;
    const mejor = _guiaCandidatos[0];
    const el = _elementosResaltablesMap.get(mejor.idx);

    agregarTurnoChat("usuario", textoUsuario);
    // Si el elemento ya no es visible, no mentimos: ofrecemos explicar.
    if (!el || !esVisible(el)) {
      const fallo =
        "No pude marcarlo con seguridad. ¿Le explico la página?";
      agregarMensaje(fallo);
      agregarTurnoChat("asistente", fallo);
      _guiaCandidatos = [];
      _guiaPos = -1;
      return;
    }
    const mensaje = confianza === "alta"
      ? (GUIA_MENSAJE_ALTA[intent] || "Le marqué lo que pidió.")
      : GUIA_MENSAJE_MEDIA;
    agregarMensaje(mensaje);
    agregarTurnoChat("asistente", mensaje);
    resaltarElementoExternoPorIdx(mejor.idx);
    console.debug("[Asistente] guía local 2F →", intent, confianza,
      "idx:", mejor.idx, "score:", mejor.score, "razón:", mejor.razon);
  }

  // Detecta una corrección del usuario sobre la última guía. Devuelve una
  // dirección ("siguiente"|"abajo"|"arriba"|"derecha"|"izquierda") o null.
  // Las direccionales tienen prioridad sobre "siguiente".
  function esCorreccionGuia(t) {
    if (!t) return null;
    if (/mas abajo|hacia abajo|el de abajo|\babajo\b/.test(t)) return "abajo";
    if (/mas arriba|hacia arriba|el de arriba|\barriba\b/.test(t)) return "arriba";
    if (/a la derecha|el de la derecha|\bderecha\b/.test(t)) return "derecha";
    if (/a la izquierda|el de la izquierda|\bizquierda\b/.test(t)) return "izquierda";
    if (/no es ese|no es esa|no era ese|ese no|esa no|\botro\b|\botra\b|equivocad/.test(t)) {
      return "siguiente";
    }
    return null;
  }

  // Elige un candidato en una dirección respecto del resaltado actual.
  // Usa la geometría EN VIVO (la página pudo scrollear). Devuelve el de
  // mayor score que cumpla la dirección, o null.
  function _elegirCandidatoDireccion(direccion) {
    const actual = _guiaCandidatos[_guiaPos];
    if (!actual) return null;
    const elActual = _elementosResaltablesMap.get(actual.idx);
    if (!elActual) return null;
    const ra = elActual.getBoundingClientRect();
    const cax = ra.left + ra.width / 2;
    const cay = ra.top + ra.height / 2;
    let mejor = null;
    let mejorPos = -1;
    _guiaCandidatos.forEach((c, i) => {
      if (i === _guiaPos) return;
      const e = _elementosResaltablesMap.get(c.idx);
      if (!e || !esVisible(e)) return;
      const r = e.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let cumple = false;
      if (direccion === "abajo") cumple = cy > cay + 4;
      else if (direccion === "arriba") cumple = cy < cay - 4;
      else if (direccion === "derecha") cumple = cx > cax + 4;
      else if (direccion === "izquierda") cumple = cx < cax - 4;
      if (!cumple) return;
      if (!mejor || c.score > mejor.score) { mejor = c; mejorPos = i; }
    });
    if (mejor) _guiaPos = mejorPos;
    return mejor;
  }

  // Maneja la corrección del usuario. "no es ese"/"otro" avanza al siguiente
  // candidato local; las direccionales eligen el candidato hacia ese lado.
  // Si se acaban los candidatos locales, reconsulta al asistente (backend) con
  // la PREGUNTA ORIGINAL para encontrar la sección correcta. Nunca navega ni
  // hace clic.
  async function manejarCorreccionGuia(direccion, textoUsuario) {
    let elegido = null;
    if (direccion === "siguiente") {
      if (_guiaPos + 1 < _guiaCandidatos.length) {
        _guiaPos += 1;
        elegido = _guiaCandidatos[_guiaPos];
      }
    } else {
      elegido = _elegirCandidatoDireccion(direccion);
    }
    // Sin más candidatos locales: en vez de quedarnos pegados, caemos al
    // asistente con la pregunta original (no con "no es ese") — el backend sí
    // entiende p.ej. "devoluciones" y puede marcar el enlace correcto. En modo
    // sensible se mantiene el invariante: flag de seguridad y SIN resaltar.
    if (!elegido) {
      const preguntaOriginal = _guiaTextoOriginal || textoUsuario;
      _guiaCandidatos = []; // cerrar la guía local: el próximo "no es ese" ya no recicla
      _guiaPos = -1;
      const pagina = obtenerResumenCacheadoOFresco(false);
      if (modoPaginaSensible && modoPaginaSensible.esSensible) {
        await consultarExplicarPagina(preguntaOriginal, { pagina, seguridad: modoPaginaSensible, permitirResaltar: false });
      } else {
        await consultarExplicarPagina(preguntaOriginal, { pagina, permitirResaltar: true });
      }
      return;
    }
    agregarTurnoChat("usuario", textoUsuario);
    const el = _elementosResaltablesMap.get(elegido.idx);
    if (!el || !esVisible(el)) {
      const msg = "No pude marcar esa opción. ¿Le explico la página?";
      agregarMensaje(msg);
      agregarTurnoChat("asistente", msg);
      return;
    }
    const msg = "Le marqué otra opción. Si tampoco es, diga “otro”.";
    agregarMensaje(msg);
    agregarTurnoChat("asistente", msg);
    resaltarElementoExternoPorIdx(elegido.idx);
    console.debug("[Asistente] corrección guía 2F →", direccion,
      "idx:", elegido.idx, "score:", elegido.score);
  }

  // ====================================================================
  // HITO 2G — Modo sensible reforzado en páginas externas
  //
  // Detectamos páginas de login/checkout/banca/identidad con señales NO
  // invasivas (URL + DOM/accesibilidad, SIN leer values). En modo sensible
  // Iky se vuelve conservador: explica y advierte límites, bloquea guía
  // hacia login/pago/confirmación, y resalta SOLO elementos no sensibles
  // (ayuda/contacto/volver/cerrar/menú). La clasificación es 100% local
  // (no depende del LLM). No toca Google ni /interpretar.
  // ====================================================================

  // Aviso preventivo (Tarea 3A). Reemplaza el saludo externo en páginas
  // sensibles y se lee una sola vez al abrir el panel.
  const AVISO_SENSIBLE =
    "Puedo explicarle esta página. Por el momento no puedo hacer pagos ni ingresar claves.";
  // Respuesta cuando el usuario pide guía hacia login/confirmación (Tarea 3B).
  const RESPUESTA_GUIA_BLOQUEADA_SENSIBLE =
    "Puedo explicarle esta página. Por el momento no puedo hacer pagos ni ingresar claves.";

  // --- Señales por URL (acotadas) ---
  const URL_SENALES_FUERTES = [
    "banco", "bank", "claveunica", "clave-unica",
    "payment", "checkout", "billing", "tarjeta",
  ];
  const URL_SENALES_MEDIAS = [
    "login", "signin", "signup", "oauth",
    "/account", "myaccount", "tramite", ".gov", "gob.",
  ];
  // --- Señales por DOM ---
  const SELECTOR_CC_SENSIBLE =
    'input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[autocomplete="cc-exp"], input[autocomplete="current-password"], input[autocomplete="new-password"]';
  const TEXTO_SENSIBLE_ALTO =
    /\b(cvv|codigo de seguridad|numero de tarjeta|cuenta bancaria|clave unica|datos de (su |la )?tarjeta)\b/;
  const BOTON_ACCION_SENSIBLE =
    /\b(iniciar sesion|ingresar|continuar|confirmar|pagar|finalizar compra|checkout|transferir)\b/;
  // --- Términos de pregunta que NO se guían en modo sensible (Tarea 3B) ---
  // Más amplio que detectarIntentGuiaExterna: cubre "inicio sesión", "ingreso",
  // "continuar", "confirmar", "siguiente". (pago/compra/clave ya se bloquean
  // antes, en manejarPregunta, por contieneTerminosSensibles.)
  const PREGUNTA_GUIA_PROHIBIDA_SENSIBLE =
    /\b(iniciar sesion|inicia sesion|inicio (de )?sesion|ingresar|ingreso|acceder|entrar a|log in|sign in|login|continuar|continuo|seguir|siguiente|confirmar|confirmo|finalizar|registrarme|crear (una )?cuenta)\b/;
  // --- Elementos que SÍ se pueden resaltar en modo sensible (secciones seguras) ---
  const SECCIONES_SEGURAS =
    /\b(ayuda|contacto|terminos|condiciones|privacidad|volver|atras|cerrar|salir|menu|navegacion|soporte|faq|preguntas frecuentes|acerca|inicio)\b/;
  // --- Acciones que NUNCA se resaltan en modo sensible ---
  const ACCION_PELIGROSA_ELEMENTO =
    /\b(iniciar sesion|ingresar|acceder|entrar|continuar|confirmar|finalizar|pagar|pago|transferir|comprar|checkout|registrar|crear cuenta|enviar)\b/;

  function _elevarNivel(a, b) {
    const orden = { BAJO: 0, MEDIO: 1, ALTO: 2 };
    return orden[b] > orden[a] ? b : a;
  }

  // Detector de página sensible. Solo señales NO invasivas: URL y DOM/ARIA.
  // NUNCA lee .value de inputs. Las razones son etiquetas genéricas (jamás
  // contienen datos del usuario) para poder loguearlas sin filtrar nada.
  function detectarSensibilidadPaginaExterna() {
    const razones = [];
    let nivel = "BAJO";

    // --- URL ---
    const host = (window.location.hostname || "").toLowerCase();
    const path = (window.location.pathname || "").toLowerCase();
    const url = host + " " + path;
    if (esPaginaSensitivaPorUrl()) { razones.push("url-lista-base"); nivel = _elevarNivel(nivel, "MEDIO"); }
    if (URL_SENALES_FUERTES.some((s) => url.includes(s))) { razones.push("url-finanzas-identidad"); nivel = _elevarNivel(nivel, "ALTO"); }
    if (URL_SENALES_MEDIAS.some((s) => url.includes(s))) { razones.push("url-login-cuenta"); nivel = _elevarNivel(nivel, "MEDIO"); }

    // --- DOM (sin leer values) ---
    try {
      const pass = document.querySelector('input[type="password"]');
      if (pass && esVisible(pass)) { razones.push("input-password-visible"); nivel = _elevarNivel(nivel, "ALTO"); }
      if (document.querySelector(SELECTOR_CC_SENSIBLE)) { razones.push("autocomplete-tarjeta-clave"); nivel = _elevarNivel(nivel, "ALTO"); }

      const textoVis = normalizar(((document.body && document.body.innerText) || "").slice(0, 4000));
      if (TEXTO_SENSIBLE_ALTO.test(textoVis)) { razones.push("texto-tarjeta-cuenta"); nivel = _elevarNivel(nivel, "ALTO"); }

      // Formulario con varios campos + botón de acción sensible.
      let maxInputsForm = 0;
      for (const f of document.querySelectorAll("form")) {
        if (!esVisible(f)) continue;
        const n = f.querySelectorAll("input, select").length;
        if (n > maxInputsForm) maxInputsForm = n;
      }
      let botonAccion = false;
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!esVisible(b)) continue;
        const t = normalizar((b.textContent || "") + " " + (b.getAttribute("aria-label") || ""));
        if (BOTON_ACCION_SENSIBLE.test(t)) { botonAccion = true; break; }
      }
      if (botonAccion && maxInputsForm >= 3) { razones.push("form-multicampo-accion"); nivel = _elevarNivel(nivel, "MEDIO"); }

      // iframe de pago (heurística por src/title, sin tocar su contenido).
      for (const f of document.querySelectorAll("iframe")) {
        if (!esVisible(f)) continue;
        const meta = ((f.getAttribute("src") || "") + " " + (f.getAttribute("title") || "")).toLowerCase();
        if (/payment|checkout|pago|3ds|secure|paypal|webpay|stripe/.test(meta)) {
          razones.push("iframe-pago"); nivel = _elevarNivel(nivel, "MEDIO"); break;
        }
      }
    } catch (_) {
      // DOM atípico: no escalamos por un error de consulta.
    }

    return { esSensible: nivel !== "BAJO", razones, nivel };
  }

  // Estado de modo sensible en runtime (Tarea 2). Se cachea por urlKey y se
  // recalcula al cambiar de URL o ante "actualiza/relee".
  let modoPaginaSensible = { esSensible: false, nivel: "BAJO", razones: [] };
  let _modoSensibleUrlKey = null;

  function actualizarModoSensible(forzar) {
    const k = obtenerUrlKeyActual();
    if (forzar || k !== _modoSensibleUrlKey) {
      modoPaginaSensible = detectarSensibilidadPaginaExterna();
      _modoSensibleUrlKey = k;
      console.debug("[Iky] modo sensible:", modoPaginaSensible);
    }
    return modoPaginaSensible;
  }

  // ¿La pregunta pide guía hacia login/confirmación? (se rechaza en sensible)
  function esPreguntaGuiaProhibidaSensible(textoNorm) {
    return PREGUNTA_GUIA_PROHIBIDA_SENSIBLE.test(textoNorm || "");
  }

  // ¿El intent de guía 2F está permitido en modo sensible? (Tarea 3C)
  function intentPermitidoEnModoSensible(intent, nivel, pagina, textoNorm) {
    if (!intent) return true; // sin intent = pregunta de explicación
    if (intent === GUIA_INTENT.LOGIN || intent === GUIA_INTENT.CONTINUAR) return false;
    if (intent === GUIA_INTENT.CERRAR_POPUP
        || intent === GUIA_INTENT.MENU
        || intent === GUIA_INTENT.BUSCAR_EN_PAGINA) {
      return true;
    }
    if (intent === GUIA_INTENT.ACEPTAR_COOKIES) {
      if (nivel === "ALTO") return false;          // ALTO: ni cookies
      return _bannerEsClaramenteDeCookies(pagina, textoNorm); // MEDIO: solo si es banner de cookies
    }
    return false;
  }

  function _bannerEsClaramenteDeCookies(pagina, textoNorm) {
    if (/cookie|consent/.test(textoNorm || "")) return true;
    return (pagina && Array.isArray(pagina.elementos) ? pagina.elementos : []).some((e) =>
      /cookie|consent/.test(normalizar([e.texto, e.ariaLabel].filter(Boolean).join(" ")))
    );
  }

  // ¿Es seguro resaltar este elemento en modo sensible? Nunca inputs, nunca
  // acciones de credencial/dinero/confirmación; en ALTO, solo secciones claras.
  function esElementoSeguroEnModoSensible(elemento, nivel) {
    if (!elemento) return false;
    if (elemento.tipo === "input") return false;
    const hay = normalizar([elemento.texto, elemento.ariaLabel, elemento.placeholder].filter(Boolean).join(" "));
    if (!hay) return false;
    if (GUIA_ELEMENTO_BLOQUEADO.test(hay)) return false;     // pago/banco/clave (regla 2F)
    if (ACCION_PELIGROSA_ELEMENTO.test(hay)) return false;   // login/continuar/confirmar/pagar…
    if (nivel === "ALTO") return SECCIONES_SEGURAS.test(hay);
    return true;
  }

  // Timeout cliente del chat de página. El backend tiene su propio cap;
  // 6s es el umbral después del cual conviene caer al fallback antes que
  // dejar al usuario esperando.
  const EXPLICAR_PAGINA_TIMEOUT_CLIENTE_MS = 6000;
  const RESPUESTA_BACKEND_NO_DISPONIBLE_PAGINA =
    "No puedo responder ahora. Intente de nuevo.";

  // Helper único de llamada a /explicar-pagina. Registra el turno del usuario,
  // arma el mensaje al service worker (con candidatos/seguridad opcionales),
  // muestra la respuesta saneada y resalta SOLO si se permite. Centraliza el
  // timeout, los fallbacks y el saneo para los flujos 2F (normal) y 2G (sensible).
  async function consultarExplicarPagina(texto, opciones) {
    const opts = opciones || {};
    agregarTurnoChat("usuario", texto);
    const historialPrevio = obtenerHistorialReciente().slice(0, -1);

    console.debug("[Asistente] página externa →",
      "seguimiento:", esPreguntaDeSeguimiento(normalizar(texto)),
      "historial enviado:", historialPrevio.length,
      "sensible:", opts.seguridad ? opts.seguridad.nivel : "no",
      "resumen:", obtenerUrlKeyActual() === ultimoUrlKey ? "cache" : "fresco");

    perfLog("backend_request_inicio", { endpoint: "/explicar-pagina" });
    const _tBackend = perfNow();
    let resp;
    try {
      resp = await Promise.race([
        chrome.runtime.sendMessage({
          tipo: "EXPLICAR_PAGINA",
          pregunta: texto,
          historial: historialPrevio,
          pagina: opts.pagina,
          // HITO 2F: candidatos sugeridos cuando la guía local no tuvo confianza.
          candidatos: opts.candidatos || undefined,
          // HITO 2G: flag de seguridad (refuerza prompt y fuerza idx=null).
          seguridad: opts.seguridad || undefined,
        }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), EXPLICAR_PAGINA_TIMEOUT_CLIENTE_MS)
        ),
      ]);
    } catch (e) {
      perfLog("backend_request_error", { endpoint: "/explicar-pagina", duracionMs: perfDuracion(_tBackend), error: (e && e.name === "Error" && e.message === "timeout") ? "timeout" : (e && e.name) || "Error" });
      agregarMensaje(RESPUESTA_BACKEND_NO_DISPONIBLE_PAGINA);
      return;
    }
    if (!resp || !resp.ok || !resp.data) {
      perfLog("backend_request_error", { endpoint: "/explicar-pagina", duracionMs: perfDuracion(_tBackend), error: "no_ok" });
      agregarMensaje(RESPUESTA_BACKEND_NO_DISPONIBLE_PAGINA);
      return;
    }
    perfLog("backend_request_fin", { endpoint: "/explicar-pagina", duracionMs: perfDuracion(_tBackend), ok: true });

    const { mensaje, elementoAResaltar } = resp.data;
    const seguro =
      sanitizarMensajeIA(mensaje) || "No estoy seguro de lo que aparece en esta página.";
    agregarMensaje(seguro);
    agregarTurnoChat("asistente", seguro);
    // En modo sensible NUNCA resaltamos desde el backend (doble defensa: el
    // backend ya fuerza idx=null). En flujo normal, resaltamos el idx devuelto.
    if (opts.permitirResaltar !== false) {
      resaltarElementoExternoPorIdx(elementoAResaltar);
    }
  }

  // HITO 2G — flujo conservador para páginas sensibles. Explica y advierte,
  // bloquea guía hacia login/confirmación, y resalta SOLO elementos seguros.
  async function responderEnModoSensible(texto, textoNorm, modo, pagina) {
    // 1) Guía prohibida (login/ingresar/continuar/confirmar/…): rechazo local.
    if (esPreguntaGuiaProhibidaSensible(textoNorm)) {
      agregarMensaje(RESPUESTA_GUIA_BLOQUEADA_SENSIBLE);
      agregarTurnoChat("usuario", texto);
      agregarTurnoChat("asistente", RESPUESTA_GUIA_BLOQUEADA_SENSIBLE);
      console.debug("[Iky] 2G rechazo guía sensible:", modo.nivel);
      return;
    }

    // 2) Intent de guía 2F, validado contra el nivel sensible.
    const intent = detectarIntentGuiaExterna(textoNorm);
    if (intent && !intentPermitidoEnModoSensible(intent, modo.nivel, pagina, textoNorm)) {
      agregarMensaje(RESPUESTA_GUIA_BLOQUEADA_SENSIBLE);
      agregarTurnoChat("usuario", texto);
      agregarTurnoChat("asistente", RESPUESTA_GUIA_BLOQUEADA_SENSIBLE);
      console.debug("[Iky] 2G intent bloqueado:", intent, modo.nivel);
      return;
    }
    if (intent) {
      // Intent permitido (MENU/CERRAR_POPUP/BUSCAR/cookies-en-MEDIO): rankeamos
      // pero FILTRAMOS a elementos seguros antes de resaltar.
      perfLog("ranking_inicio", { intent, elementosCount: pagina.elementos.length });
      const _tRank = perfNow();
      const ranking = rankearElementosParaIntent(intent, pagina.elementos, pagina.viewport)
        .filter((c) => esElementoSeguroEnModoSensible(pagina.elementos[c.idx], modo.nivel));
      const mejor = ranking[0];
      const _mejorScore = mejor ? mejor.score : 0;
      perfLog("ranking_fin", {
        duracionMs: perfDuracion(_tRank),
        intent,
        mejorScore: _mejorScore,
        candidatosCount: ranking.length,
        resolucion: _mejorScore >= UMBRAL_GUIA_MEDIA ? "local" : "sin_candidato",
      });
      if (mejor && mejor.score >= UMBRAL_GUIA_MEDIA) {
        resolverGuiaLocal(intent, ranking, mejor.score >= UMBRAL_GUIA_ALTA ? "alta" : "media", texto);
        console.debug("[Iky] 2G guía segura:", intent, "idx:", mejor.idx, "nivel:", modo.nivel);
        return;
      }
      // Sin candidato seguro suficiente: caemos a explicación (sin resaltar).
    }

    // 3) Explicación: backend con flag de seguridad. NUNCA resaltamos en sensible.
    await consultarExplicarPagina(texto, { pagina, seguridad: modo, permitirResaltar: false });
  }

  async function responderPreguntaSobrePagina(texto) {
    // Asegurar que el historial corresponde a la URL actual. Si el usuario
    // navegó (SPA u otra pestaña), el historial previo se descarta.
    asegurarHistorialPaginaActual();
    // Misma lógica para el estado de la guía local (HITO 2F): si cambió la
    // URL, los candidatos previos ya no aplican.
    _resetGuiaSiCambioUrl();

    const textoNorm = normalizar(texto);
    const esActualizar = esComandoActualizar(textoNorm);
    // HITO 2G — recalcular el modo sensible (cacheado por urlKey; "actualiza"
    // lo fuerza). Se evalúa ANTES de cualquier guía o llamada al backend.
    const modo = actualizarModoSensible(esActualizar);

    // HITO 2F — corrección del usuario sobre la última guía local
    // ("no es ese", "otro", "más abajo"…). Solo aplica si hay una guía
    // local activa. Se resuelve sin backend. Las correcciones reciclan
    // candidatos ya vetados (en sensible se vetaron como seguros).
    const correccion = esCorreccionGuia(textoNorm);
    if (correccion && _guiaCandidatos.length > 0) {
      await manejarCorreccionGuia(correccion, texto);
      return;
    }

    // Comando "actualiza" sin más contenido → respuesta local + invalidar
    // caché del resumen. No llamamos al backend.
    if (esSoloComandoActualizar(textoNorm)) {
      ultimoResumenPagina = null; // forzar reconstrucción en próximo turno
      ultimoUrlKey = null;
      const respLocal = "Volví a mirar la página. ¿En qué le ayudo?";
      agregarMensaje(respLocal);
      agregarTurnoChat("usuario", texto);
      agregarTurnoChat("asistente", respLocal);
      return;
    }

    // Construir resumen: si esActualizar viene mezclado con otra pregunta,
    // forzamos reconstrucción para este turno. Si no, usamos caché.
    const _urlKeyResumen = obtenerUrlKeyActual();
    const _cacheHitResumen = !esActualizar && _urlKeyResumen === ultimoUrlKey && !!ultimoResumenPagina;
    const _tResumen = perfNow();
    if (!_cacheHitResumen) perfLog("resumen_pagina_inicio", { urlKey: _urlKeyResumen });
    const pagina = obtenerResumenCacheadoOFresco(esActualizar);
    if (_cacheHitResumen) {
      perfLog("resumen_pagina_cache", { urlKey: _urlKeyResumen });
    } else {
      perfLog("resumen_pagina_fin", {
        duracionMs: perfDuracion(_tResumen),
        textoLength: pagina.textoVisible.length,
        encabezados: pagina.encabezados.length,
        elementos: pagina.elementos.length,
        cache: false,
      });
    }

    // HITO 2G — en página sensible, ruteo conservador (explica/advierte,
    // bloquea guía a login/pago/confirmación, resalta solo seguro).
    if (modo.esSensible) {
      await responderEnModoSensible(texto, textoNorm, modo, pagina);
      return;
    }

    // HITO 2F — intent de guía determinístico (login/continuar/cookies/…).
    // Si hay evidencia suficiente resolvemos local SIN backend; si no,
    // adjuntamos los mejores candidatos al fallback de IA.
    let candidatosFallback = null;
    const intentGuia = detectarIntentGuiaExterna(textoNorm);
    if (intentGuia) {
      perfLog("ranking_inicio", { intent: intentGuia, elementosCount: pagina.elementos.length });
      const _tRank = perfNow();
      const ranking = rankearElementosParaIntent(intentGuia, pagina.elementos, pagina.viewport);
      const mejor = ranking[0];
      const _mejorScore = mejor ? mejor.score : 0;
      perfLog("ranking_fin", {
        duracionMs: perfDuracion(_tRank),
        intent: intentGuia,
        mejorScore: _mejorScore,
        candidatosCount: ranking.length,
        resolucion: _mejorScore >= UMBRAL_GUIA_MEDIA ? "local" : (ranking.length > 0 ? "fallback_ia" : "sin_candidato"),
      });
      if (mejor && mejor.score >= UMBRAL_GUIA_ALTA) {
        resolverGuiaLocal(intentGuia, ranking, "alta", texto);
        return;
      }
      if (mejor && mejor.score >= UMBRAL_GUIA_MEDIA) {
        resolverGuiaLocal(intentGuia, ranking, "media", texto);
        return;
      }
      // Baja confianza: caemos al backend, pero pasamos los top-5 candidatos
      // (idx ya válidos) para que el modelo elija entre pocos, no entre 30.
      if (ranking.length > 0) {
        candidatosFallback = ranking.slice(0, 5).map((c) => {
          const el = pagina.elementos[c.idx] || {};
          return {
            idx: c.idx,
            texto: el.texto || el.ariaLabel || el.placeholder || null,
            razon: c.razon,
            score: c.score,
          };
        });
      }
      console.debug("[Asistente] guía 2F baja confianza → fallback IA",
        "intent:", intentGuia, "candidatos:", candidatosFallback ? candidatosFallback.length : 0);
    }

    // Fallback / explicación general (no sensible): backend con resaltado normal.
    await consultarExplicarPagina(texto, {
      pagina,
      candidatos: candidatosFallback,
      permitirResaltar: true,
    });
  }

  // ejecutarIntencion recibe el texto original y el riesgo ya clasificado
  // por manejarPregunta. El riesgo decide cuánta confirmación pedir:
  // BAJO ejecuta directo, MEDIO confirma una vez, ALTO bloquea con mensaje
  // seguro local (defensa adicional al guardrail del backend).
  function ejecutarIntencion(intencion, textoOriginal, riesgo) {
    limpiarAccionesContextuales();

    if (riesgo === "ALTO") {
      agregarMensaje(RESPUESTA_FUERA_DE_ALCANCE_LOCAL);
      return;
    }

    if (intencion.tipo === "RESALTAR_BARRA") {
      const barra = encontrarBarra();
      if (barra) {
        agregarMensaje(mensajeParaMostrar(intencion, RESPUESTA_RESALTAR));
        resaltar(barra);
      } else {
        // Camino de error: la IA pudo haber prometido que marcó la barra.
        // Forzamos el hardcoded para no mentirle al usuario.
        agregarMensaje(RESPUESTA_NO_ENCONTRADA);
      }
      return;
    }

    if (intencion.tipo === "RESALTAR_CON_CONSULTA") {
      if (riesgo === "BAJO") {
        // "busca X" / "búscame X" / "quiero buscar X": el usuario es
        // explícito, ejecutamos sin confirmar.
        ejecutarBusquedaDirecta(intencion.consulta);
      } else {
        // "quiero usar X" / "quiero abrir X": escribimos pero preguntamos
        // antes de buscar.
        iniciarFlujoEscrituraConPreguntaBusqueda(intencion.consulta);
      }
      return;
    }

    if (intencion.tipo === "EXPLICAR_RESULTADOS"
        || intencion.tipo === "ABRIR_PRIMER_RESULTADO") {
      // El flujo de explicar resultados ya integra la pregunta de abrir
      // el primer resultado vía mostrarAccionAbrirPrimerResultado.
      explicarResultados(intencion);
      return;
    }

    agregarMensaje(mensajeParaMostrar(intencion, RESPUESTA_DESCONOCIDO));
  }

  // ---- Acciones contextuales (flujo simplificado por riesgo) ----

  function limpiarAccionesContextuales() {
    while (accionesContextuales.firstChild) {
      accionesContextuales.removeChild(accionesContextuales.firstChild);
    }
    // accionPendiente está atada al botón visible: si limpiamos botones,
    // limpiamos también el estado. Las funciones mostrarAccionXXX llaman
    // a limpiar primero y luego registran la nueva acción, así que el
    // orden queda consistente.
    clearAccionPendiente();
  }

  function crearBotonContextual(texto, clase, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = texto;
    b.className = clase;
    b.addEventListener("click", onClick);
    return b;
  }

  function escribirConsultaEnBarra(consulta) {
    const barra = encontrarBarra();
    if (!barra) return null;
    resaltar(barra);
    barra.focus();
    // Usamos el setter nativo para que listeners tipo framework
    // (React/MutationObserver) detecten el cambio de value.
    const proto = barra.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setterNativo = Object.getOwnPropertyDescriptor(proto, "value").set;
    setterNativo.call(barra, consulta);
    barra.dispatchEvent(new Event("input", { bubbles: true }));
    barra.dispatchEvent(new Event("change", { bubbles: true }));
    return barra;
  }

  function obtenerTextoActualBarra() {
    const barra = encontrarBarra();
    return barra ? (barra.value || "").trim() : "";
  }

  // ---- Búsqueda directa (riesgo BAJO) ----
  // El usuario fue explícito ("busca X"). Escribimos y ejecutamos la
  // búsqueda en un solo paso, sin botones intermedios.
  function ejecutarBusquedaDirecta(consulta) {
    const barra = escribirConsultaEnBarra(consulta);
    if (!barra) {
      agregarMensaje(RESPUESTA_NO_ENCONTRADA);
      return;
    }
    agregarMensaje("Buscaré “" + consulta + "” en Google.");
    chat.busquedaEnCurso = true;
    chat.ultimaConsulta = consulta;
    guardarEstadoChat();
    ejecutarBusquedaActual(consulta);
  }

  // ---- Flujo con una sola confirmación (riesgo MEDIO) ----
  // El usuario dijo "quiero usar X" / "quiero abrir X": escribimos pero
  // preguntamos antes de iniciar la búsqueda. El "sí" del usuario en
  // estado BUSCAR_AHORA ejecuta la búsqueda directamente.
  function iniciarFlujoEscrituraConPreguntaBusqueda(consulta) {
    const barra = escribirConsultaEnBarra(consulta);
    if (!barra) {
      agregarMensaje(RESPUESTA_NO_ENCONTRADA);
      return;
    }
    chat.ultimaConsulta = consulta;
    agregarMensaje(
      "Escribí “" + consulta + "”. ¿Quiere que lo busque?"
    );
    mostrarAccionBuscarAhora(consulta);
  }

  function mostrarAccionBuscarAhora(consulta) {
    limpiarAccionesContextuales();
    setAccionPendiente({ tipo: "BUSCAR_AHORA", consulta, resultado: null });
    accionesContextuales.appendChild(
      crearBotonContextual("Buscar ahora", "ag-btn-primario", () => {
        confirmarBusqueda(consulta);
      })
    );
    accionesContextuales.appendChild(
      crearBotonContextual("Cancelar", "ag-btn-tenue", () => {
        limpiarAccionesContextuales();
        agregarMensaje(CANCEL_BUSQUEDA);
      })
    );
  }

  function confirmarBusqueda(consulta) {
    limpiarAccionesContextuales();
    const barra = encontrarBarra();
    if (!barra) {
      agregarMensaje(RESPUESTA_NO_ENCONTRADA);
      return;
    }
    if (!obtenerTextoActualBarra()) {
      agregarMensaje(RESPUESTA_BARRA_VACIA);
      return;
    }
    // Avisamos antes de disparar el submit para que el mensaje quede en
    // el DOM antes de que la página navegue a los resultados.
    agregarMensaje("Listo. Ahora verá los resultados.");
    // Persiste el flag ANTES del submit: la navegación es instantánea y si no
    // guardamos aquí el próximo content.js no sabrá que viene de una búsqueda
    // iniciada por el asistente.
    chat.busquedaEnCurso = true;
    chat.ultimaConsulta = obtenerTextoActualBarra() || consulta;
    guardarEstadoChat();
    ejecutarBusquedaActual(consulta);
  }

  function ejecutarBusquedaActual(consulta) {
    const barra = encontrarBarra();
    if (!barra) return false;
    barra.focus();
    // Preferimos enviar el form al que pertenece la barra: es lo que Google
    // espera y respeta sus listeners de submit. Sólo si no hay form caemos
    // en simular un Enter sintético.
    const form = barra.form || barra.closest("form");
    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return true;
    }
    const eventoEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    barra.dispatchEvent(eventoEnter);
    return true;
  }

  // ---- Abrir primer resultado (UNA confirmación, en nueva pestaña) ----
  // Abrir un dominio externo siempre exige confirmación. La pregunta la
  // emite explicarResultados como parte del mensaje principal (UN solo
  // agregarMensaje, evita que dos TTS se superpongan). Esta función solo
  // registra accionPendiente y muestra los botones.
  function mostrarAccionAbrirPrimerResultado(resultado) {
    limpiarAccionesContextuales();
    setAccionPendiente({ tipo: "ABRIR_PRIMER_RESULTADO", consulta: null, resultado });
    accionesContextuales.appendChild(
      crearBotonContextual("Sí, abrir", "ag-btn-primario", () => {
        confirmarAbrirResultado(resultado);
      })
    );
    accionesContextuales.appendChild(
      crearBotonContextual("Cancelar", "ag-btn-tenue", () => {
        limpiarAccionesContextuales();
        agregarMensaje(CANCEL_ABRIR);
      })
    );
  }

  function confirmarAbrirResultado(resultado) {
    limpiarAccionesContextuales();
    const abierto = abrirPrimerResultadoEnNuevaPestana(resultado && resultado.url);
    if (abierto) {
      agregarMensaje(
        "Listo, lo abrí en otra pestaña."
      );
      // Silenciar ESTA pestaña (la original): el usuario probablemente se
      // mueve a la nueva. Si Iky sigue escuchando aquí, contestaría junto
      // con el Iky de la nueva pestaña. El usuario puede reactivar
      // manualmente si quiere volver a usar Iky en esta pestaña.
      silenciarEstaPestana();
    } else {
      agregarMensaje(
        "No pude abrirlo. Haga clic en el título marcado."
      );
    }
  }

  // Apaga voz (TTS) y mic (modo escucha) en esta pestaña, sin persistir
  // las preferencias. Se invoca cuando Iky abre otra pestaña y conviene
  // dejar callado al Iky de aquí para evitar respuestas duplicadas.
  function silenciarEstaPestana() {
    _silenciadoPorOrigen = true;
    // NO cortamos el TTS en curso: el mensaje "Listo, abrí el primer
    // resultado..." debe leerse completo. Solo apagamos para próximos
    // mensajes.
    if (vozActivada) {
      vozActivada = false;
      actualizarBotonVoz();
    }
    if (modoEscuchaActivado) {
      // detenerModoEscucha cierra recognition + ventana conversacional
      // y actualiza el botón. No toca la preferencia persistente.
      detenerModoEscucha();
    }
  }

  function abrirPrimerResultadoEnNuevaPestana(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    try {
      // Usamos un <a> con target=_blank y .click() en vez de window.open()
      // porque window.open(url, "_blank", "noopener,...") siempre devuelve
      // null en Chrome cuando se incluye noopener (es por diseño: el
      // opener pierde acceso a la nueva ventana). Eso hacía que reportáramos
      // "no pude abrir" aunque la pestaña sí se abriera. Con un <a> simulado
      // conservamos noopener/noreferrer y obtenemos un resultado confiable.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Respuesta conversacional a acción pendiente ----

  // Clasifica una frase libre del usuario en una de las categorías
  // conversacionales que entiende el asistente. Tokeniza el texto y
  // acepta combinaciones de palabras conversacionales conocidas
  // (ej: "sí hacerlo", "sí por favor", "ok dale"). Si aparece cualquier
  // token desconocido, devuelve null para que la frase la maneje
  // interpretarPrincipal como nueva intención.
  //
  // TODO: Futuro: clasificador IA para respuestas ambiguas, sin ejecutar
  // acciones directamente. Hoy las reglas locales bastan para respuestas
  // obvias y críticas; cualquier cosa más compleja cae a interpretarPrincipal
  // como nueva intención. Mantener confirmaciones de escritura/búsqueda/abrir
  // fuera del alcance de la IA por seguridad.
  function clasificarRespuestaConversacional(texto) {
    // Toda puntuación → espacio, no solo la final. "sí, hacerlo" y
    // "sí hacerlo" deben clasificar igual.
    const t = normalizar(texto)
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return null;

    // Frases multi-palabra reconocidas como un todo (toman precedencia
    // sobre la clasificación por tokens).
    if (t === "abre el primero"
        || t === "abra el primero"
        || t === "abrir primer resultado"
        || t === "abrir el primero") {
      return "COMANDO_ABRIR";
    }
    // "buscar ahora" refleja el texto del botón visible. El matching por
    // tokens también lo resolvería como buscar+NEUTRAL, pero el match
    // explícito es más predecible y robusto a variantes.
    if (t === "buscar ahora") {
      return "COMANDO_BUSCAR";
    }

    // Sets por categoría. "hazlo por mi" entra como aceptación porque
    // sus tokens caen en ACEPTACION + NEUTRAL. La regla crítica —
    // no saltarse confirmaciones — la garantiza la máquina de estados:
    // en HACERLO_POR_MI nunca ejecuta escritura directa, sino que pide
    // confirmación antes.
    const ACEPTACION = new Set([
      "si", "dale", "ya", "ok", "okay", "okey",
      "hazlo", "hacelo", "hacerlo", "hagalo", "haga",
      // Afirmaciones chilenas habladas y "sí po"/"ya po" pegados por el motor.
      "claro", "obvio", "perfecto", "sip", "sipo", "yapo",
      "escribelo", "escribirlo",
      // Variantes que el motor Web Speech produce cuando transcribe "sí"
      // mal por la cercanía fonética /si/ ↔ /ˈizi/ ↔ /jes/. Vistas en
      // logs reales — "easy" apareció cuando el usuario dijo "sí".
      "easy", "yes", "yeah",
    ]);
    const RECHAZO = new Set([
      "no", "cancelar", "cancela", "mejor", "dejalo",
    ]);
    const COMANDO_BUSCAR = new Set([
      "buscalo", "buscar", "busca", "busquelo",
    ]);
    const COMANDO_ABRIR = new Set([
      "abrelo", "abrir", "abre", "abra",
    ]);
    // Palabras que pueden acompañar sin cambiar el sentido ("sí por favor",
    // "no gracias"). No clasifican por sí solas.
    const NEUTRAL = new Set([
      "por", "favor", "gracias", "ahora", "pues",
      "mi", "entonces", "nomas", "po", "poh", "pue",
    ]);

    let aceptCount = 0;
    let rechazoCount = 0;
    let buscarCount = 0;
    let abrirCount = 0;

    for (const tok of t.split(" ")) {
      if (!tok) continue;
      if (ACEPTACION.has(tok)) aceptCount++;
      else if (RECHAZO.has(tok)) rechazoCount++;
      else if (COMANDO_BUSCAR.has(tok)) buscarCount++;
      else if (COMANDO_ABRIR.has(tok)) abrirCount++;
      // NEUTRAL y tokens desconocidos se IGNORAN (antes un desconocido abortaba
      // con null). Así "sí escríbelo", "ya po", "sí busca eso", "claro que sí"
      // se entienden como afirmación aunque traigan palabras que no conocemos.
      // La confirmación crítica de abrir resultado deja de loopear pero sigue
      // exigiendo una palabra de afirmación/comando (no avanza con frase vacía).
    }

    // Sin ninguna palabra conversacional accionable → nueva intención (como
    // antes). Evita confirmar por accidente una frase arbitraria.
    if (aceptCount + rechazoCount + buscarCount + abrirCount === 0) return null;

    // Prioridad: rechazo > aceptación > comando. Si hay cualquier "no"
    // explícito, gana rechazo aunque haya otras palabras.
    if (rechazoCount > 0) return "RECHAZO";
    if (aceptCount > 0) return "ACEPTACION";
    if (buscarCount > 0) return "COMANDO_BUSCAR";
    if (abrirCount > 0) return "COMANDO_ABRIR";
    return null;
  }

  function cancelarAccionPendiente(accion) {
    // Solo dos estados de confirmación: BUSCAR_AHORA y ABRIR_PRIMER_RESULTADO.
    // En ambos el rechazo limpia todo y muestra un mensaje neutro. Iky
    // siempre puede retomar la conversación con una nueva frase.
    switch (accion.tipo) {
      case "BUSCAR_AHORA":
        limpiarAccionesContextuales();
        agregarMensaje(CANCEL_BUSQUEDA);
        return;
      case "ABRIR_PRIMER_RESULTADO":
        limpiarAccionesContextuales();
        agregarMensaje(CANCEL_ABRIR);
        return;
    }
  }

  // Máquina de estados conversacional. Devuelve true si manejó la frase
  // (ya sea avanzando o cancelando), false si el texto debe seguir al
  // intérprete principal como nueva intención.
  //
  // El flujo nuevo (post política de confirmaciones adaptativas) tiene
  // solo dos estados de confirmación. En ambos, "sí"/comando contextual
  // ejecuta la acción directamente — sin paso intermedio CONFIRMAR_*.
  function manejarRespuestaAAccionPendiente(texto) {
    const respuesta = clasificarRespuestaConversacional(texto);

    // Sin acción pendiente: si el usuario sólo dijo "sí"/"no"/etc, no
    // sabemos a qué se refiere. Respondemos confusión y NO llamamos backend.
    if (!accionPendiente) {
      if (respuesta === "ACEPTACION" || respuesta === "RECHAZO") {
        agregarMensaje("Estoy confundido. ¿Qué quiere que haga?");
        return true;
      }
      // Comando contextual sin acción pendiente (ej: "búscalo" sin contexto):
      // dejamos que interpretarPrincipal decida.
      return false;
    }

    // Hay acción pendiente. Si el texto no es conversacional, lo tratamos
    // como nueva intención ("quiero buscar YouTube" reemplaza el contexto).
    if (!respuesta) return false;

    // Snapshot porque cualquier llamada a confirmar/cancelar muta accionPendiente.
    const accion = accionPendiente;

    if (respuesta === "RECHAZO") {
      cancelarAccionPendiente(accion);
      return true;
    }

    switch (accion.tipo) {
      case "BUSCAR_AHORA":
        if (respuesta === "ACEPTACION" || respuesta === "COMANDO_BUSCAR") {
          confirmarBusqueda(accion.consulta);
          return true;
        }
        return false;

      case "ABRIR_PRIMER_RESULTADO":
        if (respuesta === "ACEPTACION" || respuesta === "COMANDO_ABRIR") {
          confirmarAbrirResultado(accion.resultado);
          return true;
        }
        return false;
    }

    return false;
  }

  // ---- Lectura en voz alta (ElevenLabs + fallback Web Speech API) ----

  function speechDisponible() {
    return typeof window.speechSynthesis !== "undefined"
        && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  function estaLeyendoWebSpeech() {
    return speechDisponible() && window.speechSynthesis.speaking;
  }

  function estaLeyendoElevenLabs() {
    return audioElevenLabsReproduciendo;
  }

  // estaLeyendo() es lo que el modo escucha y el dictado consultan para
  // decidir si pueden arrancar. Tiene que cubrir AMBOS mecanismos: si
  // ElevenLabs está sonando, no queremos que el mic abra y capture la
  // propia voz del asistente.
  function estaLeyendo() {
    return estaLeyendoElevenLabs() || estaLeyendoWebSpeech();
  }

  function obtenerUltimoMensajeAsistente() {
    if (chat.mensajes && chat.mensajes.length > 0) {
      return chat.mensajes[chat.mensajes.length - 1];
    }
    // Antes de cualquier interacción, el saludo es la única "respuesta" visible.
    return (saludo && saludo.textContent) ? saludo.textContent : "";
  }

  function detenerAudioElevenLabs() {
    if (audioElevenLabs) {
      try { audioElevenLabs.pause(); } catch (e) {}
      try {
        audioElevenLabs.removeAttribute("src");
        audioElevenLabs.load();
      } catch (e) {}
    }
    if (audioElevenLabsObjectURL) {
      try { URL.revokeObjectURL(audioElevenLabsObjectURL); } catch (e) {}
      audioElevenLabsObjectURL = null;
    }
    audioElevenLabs = null;
    audioElevenLabsReproduciendo = false;
    actualizarBotonVoz();
  }

  function detenerLectura() {
    detenerAudioElevenLabs();
    if (speechDisponible()) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // Algunos navegadores lanzan en cancel() si la cola está corrupta; ignoramos.
      }
    }
    actualizarBotonVoz();
  }

  // Intento de lectura con ElevenLabs. Devuelve true si arrancó la
  // reproducción; false si no estaba configurado, falló o no entregó
  // audio en el timeout. NUNCA muestra error al usuario: el fallback es
  // silencioso (lo decide leerTexto).
  async function leerTextoElevenLabs(texto) {
    if (!texto) return false;
    perfLog("tts_backend_inicio", { proveedor: "elevenlabs" });
    const _tTtsBackend = perfNow();
    let resp;
    try {
      resp = await Promise.race([
        chrome.runtime.sendMessage({ tipo: "TTS", texto }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), TTS_BACKEND_TIMEOUT_MS)
        ),
      ]);
    } catch (e) {
      perfLog("tts_backend_fin", { proveedor: "elevenlabs", duracionMs: perfDuracion(_tTtsBackend), ok: false, error: "timeout" });
      return false;
    }
    if (!resp || !resp.ok || !resp.data || !resp.data.ok) {
      perfLog("tts_backend_fin", { proveedor: "elevenlabs", duracionMs: perfDuracion(_tTtsBackend), ok: false });
      return false;
    }
    perfLog("tts_backend_fin", { proveedor: "elevenlabs", duracionMs: perfDuracion(_tTtsBackend), ok: true });
    const { audioBase64, contentType } = resp.data;
    if (typeof audioBase64 !== "string" || !audioBase64) return false;
    // ElevenLabs devolvió audio => ya facturó estos caracteres, suene o no.
    _ttsBump({ elevenCobrado: 1, caracteresCobrados: texto.length });

    let url;
    let audio;
    try {
      // base64 → Uint8Array → Blob → object URL. atob es síncrono y rápido
      // para audios cortos de ElevenLabs (~50-150KB típicos).
      const bin = atob(audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: contentType || "audio/mpeg" });
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
    } catch (e) {
      if (url) {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }
      return false;
    }

    audioElevenLabs = audio;
    audioElevenLabsObjectURL = url;

    audio.onplay = () => {
      audioElevenLabsReproduciendo = true;
      perfLog("tts_audio_play", { proveedor: "elevenlabs", duracionDesdeSolicitudMs: _perfTtsInicio ? perfDuracion(_perfTtsInicio) : null });
      _ttsBump({ elevenSono: 1 });
      actualizarBotonVoz();
    };
    // cleanup unifica onended/onerror/onpause: marca no-reproduciendo,
    // revoca la URL una sola vez y limpia referencias para que el
    // próximo audio empiece limpio. El check `=== url`/`=== audio`
    // evita pisar un audio nuevo si dos lecturas se encadenan rápido.
    const cleanup = () => {
      audioElevenLabsReproduciendo = false;
      if (audioElevenLabsObjectURL === url) {
        try { URL.revokeObjectURL(url); } catch (e) {}
        audioElevenLabsObjectURL = null;
      }
      if (audioElevenLabs === audio) audioElevenLabs = null;
      actualizarBotonVoz();
      // Si el modo escucha estaba esperando que termináramos, lo reanudamos
      // ahora que el mic vuelve a estar libre.
      if (modoEscuchaActivado) reanudarModoEscuchaSiCorresponde();
    };
    audio.onended = cleanup;
    audio.onpause = () => { if (!audio.ended) { _ttsBump({ elevenCancelado: 1 }); cleanup(); } };
    audio.onerror = cleanup;

    try {
      await audio.play();
      return true;
    } catch (e) {
      // play() puede rechazar por bloqueo de autoplay si no hubo gesto
      // de usuario. cleanup ya revoca la URL. Audio cobrado que no sonó.
      _ttsBump({ autoplayBloqueado: 1 });
      cleanup();
      return false;
    }
  }

  // Lectura con Web Speech API. Mismo cuerpo que tenía leerTexto antes
  // del refactor, solo renombrada. La nueva leerTexto() se encarga de
  // limpiar lectura previa y elegir entre ElevenLabs y este fallback.
  function leerTextoWebSpeech(texto) {
    if (!speechDisponible() || !texto) return;
    // cancel() limpia cualquier utterance pendiente — evita que voces se encimen
    // cuando llegan mensajes seguidos (ej: confirmaciones del flujo de búsqueda).
    try { window.speechSynthesis.cancel(); } catch (e) {}
    try {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-CL";
      u.rate = 0.9;
      u.pitch = 1;
      u.volume = 1;
      u.onstart = () => {
        perfLog("tts_audio_play", { proveedor: "webspeech", duracionDesdeSolicitudMs: _perfTtsInicio ? perfDuracion(_perfTtsInicio) : null });
        _ttsBump({ webspeech: 1 });
        actualizarBotonVoz();
      };
      u.onend = () => {
        actualizarBotonVoz();
        // Reanudar modo escucha si estaba esperando que termináramos.
        // Espejo del cleanup del audio ElevenLabs.
        if (modoEscuchaActivado) reanudarModoEscuchaSiCorresponde();
      };
      u.onerror = () => {
        actualizarBotonVoz();
        // {leer:false} corta el ciclo: si la voz está rota, el aviso no debe
        // gatillar otra utterance que vuelva a fallar.
        agregarMensaje("No pude leer la respuesta en voz alta.", { leer: false });
        if (modoEscuchaActivado) reanudarModoEscuchaSiCorresponde();
      };
      window.speechSynthesis.speak(u);
      actualizarBotonVoz();
    } catch (e) {
      actualizarBotonVoz();
      agregarMensaje("No pude leer la respuesta en voz alta.", { leer: false });
    }
  }

  // Punto de entrada único para lectura. 1) corta cualquier lectura previa,
  // 2) intenta ElevenLabs, 3) si falla, cae silenciosamente a Web Speech.
  // El aviso "No pude leer..." solo se emite si ambos fallan (vía
  // leerTextoWebSpeech con {leer:false} para no entrar en loop).
  async function leerTexto(texto) {
    if (!texto) return;
    _perfTtsInicio = perfNow();
    perfLog("tts_inicio", { proveedorPreferido: "elevenlabs", textoLength: texto.length });
    _ttsBump({ solicitado: 1 });
    detenerLectura();
    const ok = await leerTextoElevenLabs(texto);
    if (ok) return;
    perfLog("tts_fallback", { desde: "elevenlabs", hacia: "webspeech" });
    leerTextoWebSpeech(texto);
  }

  function manejarClickBotonVoz() {
    if (!speechDisponible()) {
      agregarMensaje("Este navegador no permite leer respuestas en voz alta.", { leer: false });
      return;
    }
    // Caso 3: si está hablando, detenemos pero NO apagamos la preferencia.
    if (estaLeyendo()) {
      detenerLectura();
      return;
    }
    if (vozActivada) {
      // Caso 4: apagar voz.
      vozActivada = false;
      guardarPreferenciaVoz(false);
      actualizarBotonVoz();
      return;
    }
    // Caso 6: voz estaba desactivada — la activamos y leemos el último mensaje
    // como feedback inmediato de que ahora sí va a hablar.
    vozActivada = true;
    guardarPreferenciaVoz(true);
    actualizarBotonVoz();
    const texto = obtenerUltimoMensajeAsistente();
    if (texto) leerTexto(texto);
  }

  function actualizarBotonVoz() {
    if (!btnVoz) return;
    if (!speechDisponible()) {
      btnVoz.textContent = "Voz no disponible";
      btnVoz.disabled = true;
      return;
    }
    btnVoz.disabled = false;
    if (estaLeyendo()) {
      btnVoz.textContent = "Detener voz";
    } else if (vozActivada) {
      btnVoz.textContent = "Voz activada";
    } else {
      btnVoz.textContent = "Voz desactivada";
    }
  }

  // ---- Dictado por voz (Web Speech API: SpeechRecognition) ----

  let reconocimiento = null;
  let escuchando = false;

  function reconocimientoVozDisponible() {
    return typeof (window.SpeechRecognition || window.webkitSpeechRecognition) !== "undefined";
  }

  function obtenerReconocimiento() {
    if (reconocimiento) return reconocimiento;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "es-CL";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onstart = () => {
      escuchando = true;
      actualizarBotonHablar();
      actualizarEstadoMic();
    };
    r.onresult = manejarResultadoDictado;
    r.onerror = manejarErrorDictado;
    // onend siempre se dispara al final (con o sin resultado/error). Es el
    // único punto seguro para volver al estado idle.
    r.onend = () => {
      escuchando = false;
      actualizarBotonHablar();
      actualizarEstadoMic();
      // Si el modo escucha quedó activo durante el dictado manual, lo reanudamos.
      if (modoEscuchaActivado) reanudarModoEscuchaSiCorresponde();
    };
    reconocimiento = r;
    return r;
  }

  function iniciarDictado() {
    if (!reconocimientoVozDisponible()) {
      agregarMensaje("Este navegador no permite usar voz para preguntar.", { leer: false });
      return;
    }
    // Si el asistente está hablando, lo cortamos para que el micrófono no
    // capture su propia voz y no pisemos al usuario.
    if (estaLeyendo()) detenerLectura();
    // Si modo escucha está corriendo su propio recognition, lo abortamos para
    // que el mic quede libre. Su onend reanudará el ciclo cuando el manual
    // termine (porque modoEscuchaActivado sigue true).
    if (modoEscuchaActivado && reconocimientoEscucha) {
      try { reconocimientoEscucha.abort(); } catch (e) {}
    }
    // Pequeño delay para permitir liberación del mic entre instancias.
    const arrancar = () => {
      const r = obtenerReconocimiento();
      if (!r) return;
      try {
        r.start();
      } catch (e) {
        // start() lanza si ya estaba escuchando: abortar y resetear.
        try { r.abort(); } catch (_e) {}
        escuchando = false;
        actualizarBotonHablar();
      }
    };
    if (modoEscuchaActivado) {
      setTimeout(arrancar, 150);
    } else {
      arrancar();
    }
  }

  function detenerDictado() {
    if (!reconocimiento) return;
    try {
      reconocimiento.abort();
    } catch (e) {
      // ignore
    }
    escuchando = false;
    actualizarBotonHablar();
    actualizarEstadoMic();
  }

  function manejarResultadoDictado(event) {
    let texto = "";
    try {
      texto = (event.results[0][0].transcript || "").trim();
    } catch (e) {
      texto = "";
    }
    if (!texto) {
      agregarMensaje("No escuché bien. Inténtelo de nuevo.", { leer: false });
      return;
    }
    // Mostrar el texto reconocido en el input y procesar como si lo hubiera
    // escrito y presionado "Preguntar". Esto pasa por interpretarPrincipal()
    // → backend → ejecutarIntencion(), preservando todas las confirmaciones.
    input.value = texto;
    manejarPregunta();
  }

  function mensajeErrorMicrofono(error) {
    if (error === "not-allowed") {
      return "No tengo permiso para usar el micrófono. Puede activarlo desde la configuración del navegador.";
    }
    if (error === "no-speech") {
      return "No escuché nada. Inténtelo de nuevo.";
    }
    if (error === "audio-capture") {
      return "No encontré un micrófono disponible.";
    }
    return "No escuché bien. Inténtelo de nuevo.";
  }

  function manejarErrorDictado(event) {
    // "aborted" es nuestro propio abort() — no avisamos para no spamear.
    if (event && event.error === "aborted") return;
    const mensaje = mensajeErrorMicrofono(event && event.error);
    // {leer:false}: si el motor de voz está roto, leer el aviso provoca loop.
    agregarMensaje(mensaje, { leer: false });
    mostrarEstadoMicError(mensaje);
  }

  function actualizarBotonHablar() {
    if (!btnHablar) return;
    if (!reconocimientoVozDisponible()) {
      btnHablar.textContent = "Voz no disponible";
      btnHablar.disabled = true;
      return;
    }
    btnHablar.disabled = false;
    btnHablar.textContent = escuchando ? "Escuchando..." : "Hablar";
  }

  function manejarClickBotonHablar() {
    if (!reconocimientoVozDisponible()) {
      agregarMensaje("Este navegador no permite usar voz para preguntar.", { leer: false });
      return;
    }
    if (escuchando) {
      detenerDictado();
    } else {
      iniciarDictado();
    }
  }

  // ---- Modo escucha (palabra clave "asistente") ----

  let modoEscuchaActivado = false;
  let avisoPalabraClaveMostrado = false;
  let reconocimientoEscucha = null;
  // Timer id de la reanudación pendiente, para evitar dobles arranques.
  let modoEscuchaPendienteReanudar = null;

  function panelEstaAbierto() {
    return !panel.classList.contains("ag-oculto");
  }

  function obtenerReconocimientoEscucha() {
    if (reconocimientoEscucha) return reconocimientoEscucha;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "es-CL";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = manejarResultadoModoEscucha;
    r.onerror = (event) => {
      // En modo escucha los errores transitorios (no-speech, network, aborted)
      // se silencian: onend reanuda el ciclo. Solo escalamos los problemas
      // persistentes que requieren detener el modo.
      if (!event) return;
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        const mensaje = mensajeErrorMicrofono(event.error);
        agregarMensaje(mensaje, { leer: false });
        mostrarEstadoMicError(mensaje);
        detenerModoEscucha();
      }
    };
    r.onend = () => {
      if (modoEscuchaActivado) reanudarModoEscuchaSiCorresponde();
    };
    reconocimientoEscucha = r;
    return r;
  }

  function iniciarModoEscucha() {
    if (!reconocimientoVozDisponible()) {
      agregarMensaje("Este navegador no permite usar voz para preguntar.", { leer: false });
      return;
    }
    // NO cortamos el TTS aquí. comenzarEscucharCiclo respeta estaLeyendo()
    // y solo arranca el recognition cuando el TTS termina. Esto permite
    // auto-encender modo escucha durante el saludo sin matar la voz.
    // El cleanup del audio (ElevenLabs y Web Speech) llama a
    // reanudarModoEscuchaSiCorresponde al terminar.
    modoEscuchaActivado = true;
    avisoPalabraClaveMostrado = false;
    agregarMensaje(
      "Modo escucha activado. Diga “Iky” o “asistente” para empezar. Después podré seguir la conversación por unos segundos.",
      { leer: false }
    );
    actualizarBotonModoEscucha();
    actualizarEstadoMic();
    comenzarEscucharCiclo();
  }

  function detenerModoEscucha() {
    modoEscuchaActivado = false;
    avisoPalabraClaveMostrado = false;
    // Si el modo escucha se apaga, la ventana conversacional pierde sentido:
    // no hay nadie que pueda continuar la conversación sin palabra clave.
    cerrarVentanaConversacion();
    if (modoEscuchaPendienteReanudar) {
      clearTimeout(modoEscuchaPendienteReanudar);
      modoEscuchaPendienteReanudar = null;
    }
    if (reconocimientoEscucha) {
      try { reconocimientoEscucha.abort(); } catch (e) {}
    }
    actualizarBotonModoEscucha();
    actualizarEstadoMic();
  }

  function comenzarEscucharCiclo() {
    if (!modoEscuchaActivado) return;
    if (!panelEstaAbierto()) { detenerModoEscucha(); return; }
    // Esperar a que el TTS termine y a que el dictado manual no esté corriendo.
    if (estaLeyendo()) return;
    if (escuchando) return;
    const r = obtenerReconocimientoEscucha();
    if (!r) return;
    try {
      r.start();
    } catch (e) {
      // Ya estaba activo: abortar y dejar que onend dispare otra reanudación.
      try { r.abort(); } catch (_e) {}
    }
  }

  function reanudarModoEscuchaSiCorresponde() {
    if (!modoEscuchaActivado) return;
    if (!panelEstaAbierto()) { detenerModoEscucha(); return; }
    if (modoEscuchaPendienteReanudar) {
      clearTimeout(modoEscuchaPendienteReanudar);
    }
    // Pequeña pausa: deja que TTS termine y que el navegador libere el mic
    // entre llamadas seguidas a recognition.start().
    modoEscuchaPendienteReanudar = setTimeout(() => {
      modoEscuchaPendienteReanudar = null;
      if (!modoEscuchaActivado) return;
      if (!panelEstaAbierto()) { detenerModoEscucha(); return; }
      if (estaLeyendo()) { reanudarModoEscuchaSiCorresponde(); return; }
      if (escuchando) return; // manual en curso: su onend reactivará.
      comenzarEscucharCiclo();
    }, 250);
  }

  function activarVentanaConversacion() {
    conversacionActivaHasta = Date.now() + VENTANA_CONVERSACION_MS;
    console.debug("[Asistente] ventana conversacional activa hasta:", conversacionActivaHasta);
    if (ventanaConversacionTimer) clearTimeout(ventanaConversacionTimer);
    // El timer despierta a actualizarEstadoMic cuando la ventana expira en
    // silencio. Sin esto, el visual quedaría diciendo "Le escucho..." aunque
    // la ventana ya hubiera cerrado.
    ventanaConversacionTimer = setTimeout(() => {
      ventanaConversacionTimer = null;
      actualizarEstadoMic();
    }, VENTANA_CONVERSACION_MS);
  }

  function conversacionActiva() {
    return Date.now() < conversacionActivaHasta;
  }

  function cerrarVentanaConversacion() {
    conversacionActivaHasta = 0;
    if (ventanaConversacionTimer) {
      clearTimeout(ventanaConversacionTimer);
      ventanaConversacionTimer = null;
    }
    actualizarEstadoMic();
  }

  function manejarResultadoModoEscucha(event) {
    let texto = "";
    try {
      texto = (event.results[0][0].transcript || "").trim();
    } catch (e) {
      texto = "";
    }
    if (!texto) return; // onend reanudará

    const comando = extraerComandoConPalabraClave(texto);
    // Trace temporal: muestra texto crudo, comando extraído y si la ventana
    // conversacional está abierta. Útil para depurar transcripciones de Iky.
    console.debug("[Asistente] modo escucha transcript:", texto,
                  "→ comando:", comando,
                  "ventana activa:", conversacionActiva());

    // Caso 1: vino con palabra clave → procesar y (re)activar ventana.
    if (comando) {
      avisoPalabraClaveMostrado = false;
      activarVentanaConversacion();
      input.value = comando;
      manejarPregunta();
      return;
    }

    // Caso 2: sin palabra clave pero la ventana está abierta → tratar el
    // texto completo como continuación conversacional. manejarPregunta
    // ya pasa por la máquina de estados de acción pendiente, así que las
    // confirmaciones críticas siguen requeriendo "sí" explícito.
    if (conversacionActiva()) {
      activarVentanaConversacion(); // renueva la ventana con cada turno
      input.value = texto;
      manejarPregunta();
      return;
    }

    // Caso 3: sin palabra clave y sin ventana → aviso una vez.
    if (!avisoPalabraClaveMostrado) {
      avisoPalabraClaveMostrado = true;
      agregarMensaje(
        "Para usar el modo escucha, diga “Iky” o “asistente” antes de su pregunta.",
        { leer: false }
      );
    }
    return; // onend reanudará
  }

  function extraerComandoConPalabraClave(texto) {
    if (!texto) return null;
    const palabras = texto.split(/\s+/);
    for (let i = 0; i < palabras.length; i++) {
      // Comparamos cada palabra normalizada (sin tildes, sin puntuación)
      // contra la lista de palabras clave aceptadas (asistente, iky, iqui).
      const norm = normalizar(palabras[i]).replace(/[^a-z0-9]/gi, "");
      if (AG_PALABRAS_CLAVE_ESCUCHA.indexOf(norm) >= 0) {
        // Devolvemos el texto original (con tildes y mayúsculas) para no
        // perder calidad en frases como "quiero buscar receta de cazuela".
        const cola = palabras.slice(i + 1).join(" ").trim();
        const limpio = cola.replace(/^[,;:.!?\s]+/, "").trim();
        return limpio.length > 0 ? limpio : null;
      }
    }
    return null;
  }

  function actualizarBotonModoEscucha() {
    if (!btnModoEscucha) return;
    if (!reconocimientoVozDisponible()) {
      btnModoEscucha.textContent = "Modo escucha no disponible";
      btnModoEscucha.disabled = true;
      return;
    }
    btnModoEscucha.disabled = false;
    btnModoEscucha.textContent = modoEscuchaActivado
      ? "Desactivar modo escucha"
      : "Activar modo escucha";
  }

  function manejarClickBotonModoEscucha() {
    if (!reconocimientoVozDisponible()) {
      agregarMensaje("Este navegador no permite usar voz para preguntar.", { leer: false });
      return;
    }
    if (modoEscuchaActivado) {
      detenerModoEscucha();
      // Solo el toggle MANUAL persiste la preferencia. detenciones automáticas
      // (cerrar panel, error de mic, reiniciar ayuda) NO tocan la preferencia
      // para que la próxima apertura recupere el estado deseado por el usuario.
      guardarPreferenciaModoEscucha(false);
    } else {
      iniciarModoEscucha();
      guardarPreferenciaModoEscucha(true);
    }
  }

  // ---- Estado visual del micrófono y reinicio del asistente ----

  // Timer de auto-limpieza del mensaje de error en estadoMic.
  let estadoMicErrorTimer = null;

  function actualizarEstadoMic() {
    if (!estadoMic) return;
    // Si hay un mensaje de error temporal, lo respetamos hasta que su timer expire.
    if (estadoMicErrorTimer) return;
    if (escuchando) {
      estadoMic.textContent = "Estoy escuchando...";
      return;
    }
    if (modoEscuchaActivado) {
      // Durante la ventana conversacional el usuario no necesita repetir
      // la palabra clave, así que el aviso lo refleja. Cuando la ventana
      // expira (o nunca se abrió) volvemos al texto de inicio.
      if (conversacionActiva()) {
        estadoMic.textContent = "Le escucho. Puede seguir hablando sin decir “Iky”.";
      } else {
        estadoMic.textContent = "Modo escucha activo. Diga “Iky” o “asistente” para empezar.";
      }
      return;
    }
    estadoMic.textContent = "";
  }

  function mostrarEstadoMicError(mensaje) {
    if (!estadoMic) return;
    estadoMic.textContent = mensaje;
    if (estadoMicErrorTimer) clearTimeout(estadoMicErrorTimer);
    // Tras 4s liberamos al estado computado normal (escuchando, modo escucha o vacío).
    estadoMicErrorTimer = setTimeout(() => {
      estadoMicErrorTimer = null;
      actualizarEstadoMic();
    }, 4000);
  }

  function reiniciarAyuda() {
    // Cortar todo lo activo: TTS, dictado manual y modo escucha.
    if (estaLeyendo()) detenerLectura();
    if (escuchando) detenerDictado();
    if (modoEscuchaActivado) detenerModoEscucha();
    // Ventana conversacional también se cierra. detenerModoEscucha ya la
    // cierra cuando aplica; este llamado cubre el caso en que el reinicio
    // ocurra sin modo escucha activo.
    cerrarVentanaConversacion();
    // Limpiar botones contextuales (Hacerlo por mí, Buscar ahora, Sí/Cancelar,
    // Abrir primer resultado) sin tocar el historial del chat.
    limpiarAccionesContextuales();
    // Limpiar la guía visual (resaltado + cursor) al reiniciar.
    limpiarGuiasVisuales();
    // Limpiar timer de error visual si quedó pendiente.
    if (estadoMicErrorTimer) {
      clearTimeout(estadoMicErrorTimer);
      estadoMicErrorTimer = null;
    }
    actualizarEstadoMic();
    agregarMensaje("Listo. ¿En qué le ayudo?");
  }

  // ---- Construcción del DOM ----
  const boton = document.createElement("button");
  boton.id = "ag-boton-ayuda";
  boton.type = "button";
  boton.textContent = "Ayuda";

  const panel = document.createElement("div");
  panel.id = "ag-panel";
  panel.classList.add("ag-oculto");

  // Header: título + botón Minimizar/Expandir. El botón debe seguir visible en
  // modo compacto, por eso vive en el header (que nunca se oculta).
  const header = document.createElement("div");
  header.id = "ag-header";
  const titulo = document.createElement("h2");
  titulo.textContent = AG_NOMBRE_ASISTENTE;
  header.appendChild(titulo);
  const btnMinimizar = document.createElement("button");
  btnMinimizar.id = "ag-minimizar";
  btnMinimizar.type = "button";
  btnMinimizar.textContent = "Minimizar";
  btnMinimizar.setAttribute("aria-label", "Minimizar el panel");
  btnMinimizar.setAttribute("aria-expanded", "true");
  header.appendChild(btnMinimizar);
  panel.appendChild(header);

  const saludo = document.createElement("p");
  saludo.className = "ag-saludo";
  // El saludo cambia según contexto: en Google es presentación; en página
  // externa es un disclaimer corto de qué puede y qué NO puede hacer.
  // HITO 2G: en página externa SENSIBLE, el saludo es el aviso preventivo
  // reforzado (se calcula una vez al cargar). Así el límite se anuncia y se
  // lee por TTS una sola vez, sin competir con respuestas posteriores.
  if (esPaginaExterna()) {
    actualizarModoSensible(true); // calcula + loguea modoPaginaSensible
    saludo.textContent = modoPaginaSensible.esSensible
      ? AVISO_SENSIBLE
      : AG_SALUDO_PAGINA_EXTERNA;
  } else {
    saludo.textContent = AG_SALUDO_VISIBLE;
  }
  panel.appendChild(saludo);

  const mensajes = document.createElement("div");
  mensajes.id = "ag-mensajes";
  panel.appendChild(mensajes);

  const voz = document.createElement("div");
  voz.id = "ag-voz";
  const btnVoz = document.createElement("button");
  btnVoz.id = "ag-btn-voz";
  btnVoz.type = "button";
  btnVoz.className = "ag-btn-tenue";
  btnVoz.textContent = "Voz activada";
  voz.appendChild(btnVoz);
  panel.appendChild(voz);

  const accionesContextuales = document.createElement("div");
  accionesContextuales.id = "ag-acciones-contextuales";
  panel.appendChild(accionesContextuales);

  const estadoMic = document.createElement("p");
  estadoMic.id = "ag-estado-mic";
  estadoMic.setAttribute("aria-live", "polite");
  panel.appendChild(estadoMic);

  const input = document.createElement("input");
  input.id = "ag-input";
  input.type = "text";
  input.placeholder = "Escriba su duda aquí";
  input.autocomplete = "off";
  panel.appendChild(input);

  const acciones = document.createElement("div");
  acciones.className = "ag-acciones";

  const btnPreguntar = document.createElement("button");
  btnPreguntar.id = "ag-preguntar";
  btnPreguntar.type = "button";
  btnPreguntar.textContent = "Preguntar";
  acciones.appendChild(btnPreguntar);

  const btnHablar = document.createElement("button");
  btnHablar.id = "ag-hablar";
  btnHablar.type = "button";
  btnHablar.textContent = "Hablar";
  acciones.appendChild(btnHablar);

  const btnModoEscucha = document.createElement("button");
  btnModoEscucha.id = "ag-modo-escucha";
  btnModoEscucha.type = "button";
  btnModoEscucha.textContent = "Activar modo escucha";
  acciones.appendChild(btnModoEscucha);

  const btnDondeBusco = document.createElement("button");
  btnDondeBusco.id = "ag-donde-busco";
  btnDondeBusco.type = "button";
  // Misma referencia, etiqueta distinta según contexto.
  btnDondeBusco.textContent = esPaginaExterna() ? "¿Qué miro?" : "¿Dónde busco?";
  acciones.appendChild(btnDondeBusco);

  const btnExplicarResultados = document.createElement("button");
  btnExplicarResultados.id = "ag-explicar-resultados";
  btnExplicarResultados.type = "button";
  btnExplicarResultados.textContent = esPaginaExterna() ? "Explicar página" : "Explicar resultados";
  acciones.appendChild(btnExplicarResultados);

  const btnReiniciar = document.createElement("button");
  btnReiniciar.id = "ag-reiniciar";
  btnReiniciar.type = "button";
  btnReiniciar.textContent = "Reiniciar ayuda";
  acciones.appendChild(btnReiniciar);

  panel.appendChild(acciones);

  document.body.appendChild(boton);
  document.body.appendChild(panel);

  // Cursor virtual de guía (HITO 3). Se construye con createElement (sin
  // innerHTML) y vive oculto hasta que resaltar() lo active. pointer-events
  // none vía CSS: no bloquea ni recibe clics. aria-hidden porque es puramente
  // decorativo (el mensaje hablado/escrito ya describe a dónde mirar).
  const cursorGuia = document.createElement("div");
  cursorGuia.id = "ag-cursor";
  cursorGuia.setAttribute("aria-hidden", "true");
  const cursorHalo = document.createElement("div");
  cursorHalo.className = "ag-cursor-halo";
  const cursorPunto = document.createElement("div");
  cursorPunto.className = "ag-cursor-punto";
  cursorGuia.appendChild(cursorHalo);
  cursorGuia.appendChild(cursorPunto);
  document.body.appendChild(cursorGuia);

  // Limpieza por navegación: en carga completa el content script se recrea
  // (overlay fresco), pero en navegación SPA / hash / back-forward el script
  // persiste y un cursor apuntando a un elemento que ya no existe quedaría
  // colgado. pagehide cubre además el repintado durante la descarga.
  window.addEventListener("pagehide", limpiarGuiasVisuales);
  window.addEventListener("popstate", limpiarGuiasVisuales);
  window.addEventListener("hashchange", limpiarGuiasVisuales);

  // ---- Handlers ----
  boton.addEventListener("click", () => {
    panel.classList.toggle("ag-oculto");
    chat.panelAbierto = !panel.classList.contains("ag-oculto");
    guardarEstadoChat();
    if (chat.panelAbierto) {
      input.focus();
      // Saludo de bienvenida hablado: solo la primera vez que se abre el panel
      // en esta carga, y solo si el usuario aún no tuvo respuestas. El click
      // en "Ayuda" cuenta como gesto de usuario, así que el TTS no se bloquea.
      if (vozActivada && speechDisponible()
          && !saludoLeidoEnEstaSesion
          && chat.mensajes.length === 0) {
        saludoLeidoEnEstaSesion = true;
        // En Google leemos el saludo de presentación con "Iqui" (pronunciación
        // más natural que "Iky"). En página externa leemos el texto real del
        // saludo (disclaimer normal, o aviso preventivo 2G si es sensible);
        // no menciona el nombre del asistente.
        leerTexto(esPaginaExterna() ? saludo.textContent : AG_SALUDO_TTS);
      }
      // Auto-encender modo escucha si el usuario lo dejó activo (es el
      // default). iniciarModoEscucha NO corta el TTS — comenzarEscucharCiclo
      // respeta estaLeyendo() y arranca el recognition cuando el saludo
      // termine. Si el usuario lo apagó manualmente alguna vez, la
      // preferencia está en false y NO se enciende. Si esta pestaña fue
      // abierta por Iky (_silenciadoPorOrigen), tampoco se enciende — el
      // usuario tiene que activar el modo escucha explícitamente.
      if (obtenerPreferenciaModoEscucha()
          && reconocimientoVozDisponible()
          && !modoEscuchaActivado
          && !_silenciadoPorOrigen) {
        iniciarModoEscucha();
      }
    } else {
      // Panel cerrado: ningún micrófono ni TTS debe quedar activo a espaldas
      // del usuario. Apagamos cualquier captura/lectura en curso.
      if (modoEscuchaActivado) detenerModoEscucha();
      if (escuchando) detenerDictado();
      if (estaLeyendo()) detenerLectura();
      // Cerrar ventana explícitamente cubre el caso de cerrar el panel sin
      // modo escucha activo (escucha apagada manualmente pero ventana abierta
      // por un dictado manual previo, por ejemplo). detenerModoEscucha ya
      // la cierra si el modo escucha estaba activo.
      cerrarVentanaConversacion();
      actualizarEstadoMic();
      // La guía visual (resaltado + cursor) acompaña al panel: al cerrarlo,
      // desaparece de inmediato.
      limpiarGuiasVisuales();
    }
  });

  async function manejarPregunta() {
    const texto = input.value;
    // Limpiamos el input antes del await para dar feedback inmediato y no
    // pisar lo que el usuario tipee mientras esperamos al backend.
    input.value = "";
    if (!texto.trim()) {
      input.focus();
      return;
    }
    _perfPreguntaInicio = perfNow();
    perfLog("pregunta_recibida", {
      textoLength: texto.length,
      esGoogle: esGoogle(),
      esPaginaExterna: esPaginaExterna(),
      modoSensible: modoPaginaSensible.esSensible,
    });
    // Conversacional primero: si el usuario dijo "sí"/"no"/"búscalo"/etc
    // y hay una acción pendiente, avanzamos sin llamar backend. También
    // atajamos "sí"/"no" sueltos sin contexto para no confundir a la IA.
    if (manejarRespuestaAAccionPendiente(texto)) {
      input.focus();
      return;
    }
    // Guardrail temprano: si el texto trae términos sensibles (dinero,
    // claves, etc.), bloqueamos antes de llamar al backend. Evita gastar
    // cuota del modelo en frases que nunca se ejecutarían. El backend
    // safety-rules sigue siendo segunda capa.
    if (clasificarRiesgoTexto(texto) === "ALTO") {
      perfLog("pregunta_bloqueada_local", { duracionMs: perfDuracion(_perfPreguntaInicio) });
      agregarMensaje(RESPUESTA_FUERA_DE_ALCANCE_LOCAL);
      input.focus();
      return;
    }
    // Página externa: enrutar al chat contextual. Cero interacción
    // (solo describir y opcionalmente resaltar). No llamamos a
    // /interpretar — ese endpoint es del flujo Google.
    if (esPaginaExterna()) {
      // Caso especial: el usuario pide buscar en Google estando fuera de
      // Google. No abrimos pestaña; lo orientamos a volver manualmente.
      if (esSugerenciaVolverAGoogle(texto)) {
        agregarMensaje(RESPUESTA_VOLVER_A_GOOGLE);
        input.focus();
        return;
      }
      await responderPreguntaSobrePagina(texto);
      input.focus();
      return;
    }
    perfLog("interpretacion_inicio", {});
    const _tInterp = perfNow();
    const intencion = await interpretarPrincipal(texto);
    perfLog("interpretacion_fin", {
      duracionMs: perfDuracion(_tInterp),
      fuente: intencion.fuente,
      tipo: intencion.tipo,
    });
    // Riesgo se calcula en cliente con regla determinística. Decide si la
    // acción se ejecuta directo (BAJO), pide una confirmación (MEDIO) o
    // se bloquea con mensaje seguro (ALTO).
    const riesgo = clasificarRiesgoAccion(intencion, texto);
    console.debug("[Asistente] intención", intencion.tipo,
                  "fuente:", intencion.fuente,
                  "riesgo:", riesgo);
    ejecutarIntencion(intencion, texto, riesgo);
    input.focus();
  }

  btnPreguntar.addEventListener("click", manejarPregunta);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      manejarPregunta();
    }
  });

  // Botones del panel: el usuario eligió la acción visualmente. En Google
  // ejecutan intención local BAJA; en página externa rutean al chat de
  // página (sin interacción, solo describir/resaltar).
  btnDondeBusco.addEventListener("click", () => {
    if (esPaginaExterna()) {
      responderPreguntaSobrePagina("qué debería mirar en esta página");
    } else {
      ejecutarIntencion({ tipo: "RESALTAR_BARRA" }, "", "BAJO");
    }
  });

  btnExplicarResultados.addEventListener("click", () => {
    if (esPaginaExterna()) {
      responderPreguntaSobrePagina("explícame esta página");
    } else {
      ejecutarIntencion({ tipo: "EXPLICAR_RESULTADOS" }, "", "BAJO");
    }
  });

  btnVoz.addEventListener("click", manejarClickBotonVoz);

  btnHablar.addEventListener("click", manejarClickBotonHablar);

  btnModoEscucha.addEventListener("click", manejarClickBotonModoEscucha);

  btnReiniciar.addEventListener("click", reiniciarAyuda);

  // Toggle manual de compacto. Marca control manual: la auto-compactación lo
  // respeta durante RESPETAR_CONTROL_MANUAL_MS para no pelear con el usuario.
  btnMinimizar.addEventListener("click", () => {
    const compactar = !panel.classList.contains("ag-panel-compacto");
    setCompacto(compactar);
    _compactoAuto = false;
    _controlManualTs = Date.now();
  });

  // Estado inicial de los botones de voz y del indicador de micrófono.
  actualizarBotonVoz();
  actualizarBotonHablar();
  actualizarBotonModoEscucha();
  actualizarEstadoMic();

  // ---- Restauración tras navegación (resultados de búsqueda) ----
  const estadoPrevio = obtenerEstadoInicial();
  if (estadoPrevio) {
    // Reconstituir el estado local desde sessionStorage.
    chat.panelAbierto = !!estadoPrevio.panelAbierto;
    chat.mensajes = Array.isArray(estadoPrevio.mensajes) ? estadoPrevio.mensajes.slice() : [];
    chat.ultimaConsulta = estadoPrevio.ultimaConsulta || null;
    chat.busquedaEnCurso = false; // siempre se resetea al cargar

    // Renderizar mensajes previos sin volver a empujarlos al array.
    for (const texto of chat.mensajes) renderMensaje(texto);

    // Restaurar visibilidad del panel.
    if (chat.panelAbierto) panel.classList.remove("ag-oculto");

    if (estadoPrevio.busquedaEnCurso) {
      // Llegamos aquí justo después de una búsqueda iniciada por el asistente.
      // agregarMensaje empuja al array y guarda con busquedaEnCurso ya en false.
      agregarMensaje(
        "Ya ve los resultados. Si quiere, le explico cuál mirar."
      );
    } else {
      // Sin búsqueda en curso: solo persistir el estado reconstituido.
      guardarEstadoChat();
    }

    // Si el panel estaba abierto y el usuario tenía modo escucha activo,
    // lo reanudamos para preservar la continuidad entre navegaciones.
    // Si el navegador exige un gesto reciente para abrir el micrófono y
    // no lo hay, recognition.onerror activará detenerModoEscucha — el
    // usuario podrá reactivarlo manualmente.
    if (chat.panelAbierto
        && obtenerPreferenciaModoEscucha()
        && reconocimientoVozDisponible()
        && !modoEscuchaActivado
        && !_silenciadoPorOrigen) {
      iniciarModoEscucha();
    }
  }
})();
