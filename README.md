# TRASA Bingo · V1.3 (GitHub Pages)

Versión acumulativa que incluye los cambios de V1.1 y V1.2. **No necesitas instalar V1.2** antes.

## Novedades V1.3

- Menú lateral con iconos de ancho fijo: todos los textos empiezan en la misma columna.
- Administración → Historial: borrar una edición o **todo el historial**, con confirmación escrita. Esta acción solo elimina archivos de clasificación antiguos, nunca la edición activa.
- Corrección de privacidad del ranking: los resultados públicos se leen de `leaderboard/current`, sin claves secretas de los equipos. La colección `scores` queda privada para el administrador.
- Administración → Resumen: botón **Actualizar clasificación pública**, necesario una vez tras migrar si ya existían puntuaciones.

## Funciones de la V1.2 incluidas

- **Preparar nueva edición** desde Administración → Resumen tras cerrar el concurso.
- Historial privado de clasificaciones, exportación CSV y opción de reanudar la preparación.
- Premios editables (efectivo, materiales gratuitos y texto de condiciones).
- Edición de portada, edición y eliminación de equipos, reservas de State IDs, revisión de pruebas por URL.
- Las pruebas no se leen desde Firebase por los participantes antes del inicio.

## Instalación sobre GitHub + Firebase existentes

1. Publica **primero** las reglas nuevas del paquete privado `TRASA_Bingo_Firebase_Privado_V1_3.zip`. Sustituye `REEMPLAZAR_UID_ADMIN` por el UID de tu administrador.
2. En GitHub sustituye **`index.html`, `app.js` y `styles.css`** por los de este ZIP. Es importante actualizar los tres.
3. Conserva el **`config.js` real** que ya utilizas. El del ZIP solo tiene marcadores y sirve para instalaciones nuevas.
4. No elimines `assets/`; puedes mantener tus logos tal como están.
5. Recarga tu página con Ctrl + F5.
6. En Administración → Resumen pulsa **Actualizar clasificación pública** una vez. El ranking se publica sin los códigos privados de los equipos.
7. Prueba la eliminación individual de un registro de historial y, después de exportar, el borrado completo con una edición de prueba.

## Seguridad

La seguridad depende de **reglas de Firestore publicadas** (no de esconder botones ni JavaScript). La corrección de V1.3 impide que la colección `scores` se lea públicamente y revela solo los datos de clasificación necesarios. Los nombres, teléfonos RP y State IDs de un equipo se siguen mostrando a quien tenga su enlace secreto: **no compartas esos enlaces en público**. El código de acceso es una credencial de portador, no una cuenta personal.

No publiques contraseñas, archivos de servicio de Firebase ni el JSON privado de pruebas. La configuración web pública `config.js` NO es una contraseña.

La eliminación del historial es definitiva; exporta el CSV antes de borrar. Esta versión ha pasado comprobación de sintaxis y pruebas estáticas de los permisos esperados, **pero no una prueba real contra tu proyecto Firebase**; valida las reglas en el emulador o en un proyecto de pruebas antes del concurso.
