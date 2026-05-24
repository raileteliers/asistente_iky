# Test de usabilidad con la abuela (y luego con sus pares)

> **Para qué es este test:** NO es para revisar si la IA clasifica bien (eso ya
> lo cubre `npm run eval`). Es para responder UNA pregunta que el código no puede
> contestar: **¿una persona mayor, sola y sin ayuda, logra hacer algo que quería
> — y sin asustarse ni quedarse pegada?**

---

## Antes de empezar (checklist · 5 min)

- [ ] Backend corriendo en ESTE computador: `cd backend && npm start` (queda en `localhost:3000`).
- [ ] Extensión cargada en Chrome (`chrome://extensions` → Modo desarrollador → Cargar descomprimida).
- [ ] Abrir `google.cl`: confirmar que aparece el botón flotante **Ayuda**.
- [ ] Hacer TÚ una prueba rápida: una búsqueda por voz y una escrita, para confirmar que hoy nada está roto (Google cambia su página seguido).
- [ ] Voz activada. Micrófono con permiso.
- [ ] Teléfono listo para grabar **con su permiso**: *"¿Le molesta si grabo para acordarme después? No lo voy a compartir."*
- [ ] Ambiente tranquilo, sin apuro, sin otras personas mirando.

---

## Reglas de oro para ti (lo más importante)

El test se arruina si la "ayudas". Tu trabajo es **observar en silencio**.

1. **No la ayudes.** Aunque te duela verla pegada. El silencio incómodo es donde aprendes.
2. **No la guíes.** No digas "apreta ahí" ni "dile que busque". Si pregunta, devuelve la pregunta: *"¿Qué cree usted que tendría que hacer?"*
3. **No defiendas el producto.** Si algo falla, no expliques por qué. Anótalo.
4. **Pídele que piense en voz alta:** *"Cuénteme qué está pensando, qué ve, qué le confunde."*
5. **Deja que se equivoque.** Cuenta hasta 10 antes de intervenir.
6. Solo intervienes si se frustra de verdad o si algo se rompe.

---

## Las tareas (dáselas de a una, en orden)

Léele la tarea, entrégale el computador, y observa. No agregues instrucciones.

### Tarea 1 — Empezar y buscar (calentamiento)
> *"Quiero que busque una receta de algo que le guste cocinar."*

**Qué observar:**
- ¿Encuentra y abre el asistente **sola**? (o ni lo nota)
- ¿Usa la voz o prefiere escribir? ¿La voz la entiende bien?
- ¿Logra que aparezca la búsqueda en Google?

### Tarea 2 — Entender los resultados
Cuando aparezcan los resultados de la Tarea 1, dile:
> *"¿Qué son todas estas cosas que aparecieron? ¿Cuál abriría usted?"*

**Qué observar:**
- ¿La pantalla de resultados la abruma? ¿Sabe dónde mirar?
- ¿La explicación del asistente la ayuda o la confunde más?
- ¿Identifica un resultado para abrir?

### Tarea 3 — Algo de ELLA (la más importante)
> *"Ahora busque algo que usted de verdad quiera saber o ver hoy."*

**Qué observar:**
- ¿Cómo lo dice **con sus propias palabras**? (esto te da el lenguaje real de tu usuario)
- ¿El asistente entiende su forma natural de hablar?
- ¿Logra lo que quería?

### Tarea 4 — Seguridad (observar, no provocar)
Si en algún momento intenta algo fuera de alcance (pagar, clave, banco), **observa qué hace el asistente y cómo reacciona ella**. No la empujes a hacerlo.

**Qué observar:**
- ¿El mensaje de "solo puedo ayudarle a buscar" la tranquiliza o la frustra?

---

## Qué registrar (llena esto durante o justo después)

| Pregunta | Respuesta |
|---|---|
| ¿Encontró/abrió el asistente sola? | Sí / No / Con ayuda |
| ¿Voz funcionó con su forma de hablar? | Bien / Regular / No / No la usó |
| ¿Completó la Tarea 1 sin ayuda? | Sí / No |
| ¿Completó la Tarea 3 (la suya) sin ayuda? | Sí / No |
| ¿Dónde dudó o se quedó pegada? | (anota el momento exacto) |
| ¿Reacción emocional? | Tranquila / Frustrada / Contenta / Asustada |
| Frase textual que dijo (cópiala literal) | "..." |
| Lo que MÁS le costó | ... |
| Lo que le gustó / la hizo sonreír | ... |

---

## Preguntas después del test (no antes)

- *"¿Cómo se sintió usando esto? ¿Cómoda, nerviosa?"*
- *"¿Qué fue lo más confuso?"*
- *"¿Lo usaría usted sola en su casa, sin que yo esté?"*  ← la pregunta clave
- *"¿Le diría a una amiga que lo use? ¿Qué le diría?"*
- *"¿Hay algo que le hubiera gustado pedirle y no pudo?"*

---

## Cómo leer el resultado

**Funcionó (sigue adelante)** si: encontró el asistente, completó al menos la tarea de ella, y al final dice que lo usaría sola. La voz puede fallar — eso es un hallazgo, no un fracaso.

**Hay que arreglar antes de seguir** si: no pudo empezar sola, se asustó o se frustró al punto de rendirse, o no entendió nunca los resultados aunque el asistente "funcionara".

> Una sola sesión con tu abuela vale más que semanas de adivinar. Anota TODO el
> mismo día — los detalles se borran rápido. Repite con 3–5 de sus pares para
> ver qué patrones se repiten (eso es lo que de verdad importa).
