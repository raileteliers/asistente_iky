# Checklist manual de QA

Pruebas manuales antes de cada entrega. No reemplaza a `npm run eval`; cubre
lo que el eval no puede (la extensión en el navegador). No es un framework de
tests: se ejecuta a mano en Chrome.

## Preparación
- [ ] Backend levantado (`cd backend && npm start`) salvo en la prueba de fallback.
- [ ] Extensión cargada desde `chrome://extensions` (modo desarrollador).

## Flujo básico
- [ ] Abrir `google.cl`: aparece el botón flotante **Ayuda**.
- [ ] Clic en **Ayuda**: se abre el panel del asistente con el saludo.
- [ ] Botón **¿Dónde busco?**: resalta la barra de búsqueda en azul.

## Guiar búsqueda
- [ ] Escribir "quiero usar ChatGPT" y **Preguntar**: el asistente guía la
      búsqueda y la consulta es "ChatGPT" (no "usar ChatGPT").
- [ ] Aparece el botón **Hacerlo por mí**.
- [ ] **Hacerlo por mí** pide confirmación ("¿Quiere que lo haga?") antes de
      escribir nada en la barra.
- [ ] Al confirmar, escribe la consulta en la barra de Google.
- [ ] Aparece **Buscar ahora**; pide confirmación antes de ejecutar la búsqueda.
- [ ] Al confirmar, se ejecuta la búsqueda y Google muestra resultados.

## Tras navegar a resultados
- [ ] El chat del asistente se restaura (no se pierde la conversación).
- [ ] Botón **Explicar resultados**: explica los resultados y resalta el primero.
- [ ] **Abrir primer resultado** pide confirmación y, al confirmar, abre el
      resultado en una pestaña nueva (no en la actual).

## Resiliencia
- [ ] Con el backend apagado, una consulta sigue funcionando vía fallback local
      (la extensión no se rompe).

## Voz
- [ ] El botón de voz alterna entre activada/desactivada.
- [ ] Con voz activada, las respuestas del asistente se leen en voz alta.
- [ ] Botón **Hablar**: dicta una pregunta por voz y la procesa.
- [ ] **Activar modo escucha**: diciendo "asistente" seguido de una pregunta,
      el asistente la procesa.

## Reinicio
- [ ] Botón **Reiniciar ayuda**: limpia el estado y muestra el mensaje inicial.
