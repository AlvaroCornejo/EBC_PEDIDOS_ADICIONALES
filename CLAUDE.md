# EBC Pedidos Adicionales — Guía del Proyecto

## Arquitectura general

- **Frontend**: SPA vanilla JS en `public/app.js` + `public/styles.css` + `public/index.html`
- **Backend**: Node.js + Express (`server.js`, `routes/`)
- **Base de datos**: MongoDB Atlas + Mongoose (modelos en `models/`)
- **Datos Excel**: ExcelJS lee archivos en `data/` (sincronizados diariamente con `sync-excel.bat`)
- **Deploy**: GitHub → DigitalOcean App Platform (auto-deploy en push a `main`)
- **URL producción**: https://ebc-pedidos-dxnzn.ondigitalocean.app

## Proyecto relacionado: payment_app

- Ruta local: `C:\Users\alvar\payment_app\`
- Flask/Python/SQLite, corre localmente con `iniciar.bat` (puerto 5000)
- Repo: https://github.com/AlvaroCornejo/payment_app
- Servidor donde corre: CORPSERV-PRUEBA (acceso por RDP)
- Tiene su propio `CLAUDE.md` con detalle de ese proyecto

## Operaciones disponibles (ALL_OPS) — orden exacto

```javascript
['AASI', 'CORPQ', 'CDLAO', 'PLANTA', 'CORPFK', 'CDL28', 'MUVON', 'GBGOL', 'GBADC', 'GBSRQ', 'GBCFR', 'GBCRP', 'GBPLANTA', 'GBCORP']
// Fila 1 (admin form): AASI, CORPQ, CDLAO, PLANTA, CORPFK, CDL28, MUVON
// Fila 2 (admin form): GBGOL, GBADC, GBSRQ, GBCFR, GBCRP, GBPLANTA, GBCORP
// GBCFR2 eliminado
```

## Roles de usuario

| Clave | Label |
|-------|-------|
| ADMIN | Administrador |
| OPERADOR_SOLICITUD | Solicitador |
| OPERADOR_APROBACION | Aprobador |
| OPERADOR_ATENCION | Compras |
| OPERADOR_PLANTA | Planta |
| OPERADOR_CONSULTA | Consultas |

## Permisos especiales (JWT)
- `puedeVerKardex`: boolean — solo rol CONS, da acceso a vista Kardex
- `puedeVerComparativo`: boolean — acceso a Comparativo OC / Ingresos al Almacén
- `puedeVerVentas`: boolean — acceso a Venta & TIP por Operación
- `puedeVerBajas`: boolean — acceso a Seguimiento de Bajas
- `sociedadesCompra`: array — sociedades para ver Precios de Compra (ERSAC, FRQ1, GB)
- `operations`: array — operaciones asignadas al usuario
- `rolCaja`: '' | REGISTRO | CONSULTA — acceso a Cierre de Caja (ver Sesión 5)
- `accesoOficina` / `accesoDepositos`: boolean — acceso a Envío a Oficina / Depósito Bancario

## Fuentes de datos

### Excel (diario via sync-excel.bat)
- Hoja **Items**: col1=ITEM, col2=NOMBRE, col3=GRUPO COMPRA, col4=GESTION
- Hoja **Kardex**: col1=ITEM, col2=TRX, col3=AÑOSEM (YYYYWW), col4=CANTIDAD
- Hoja **Costos**: col1=ITEM, colX=COSTO (detectado dinámicamente desde cabecera)
- Hoja **Requisiciones**: col1=ITEM, col2=SEM ANT, col3=SEM ACT, col4=AJUSTE ACT, col5=AJUSTE ANT
- Ruta Box origen: `C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES\`
- Destino en servidor sync: `C:\pedidos-app\data\`

### EBC ITEMS_VENTA.xlsx (catálogo para flujo 86, diario via sync-excel.bat)
- Hoja **ITEMS_VENTA**: col1=OPERACION, col2=ITEM, col3=NOMBRE
- Ruta Box origen: `C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ITEMS\EBC ITEMS_VENTA.xlsx`
- Destino en servidor sync: `C:\pedidos-app\data\EBC ITEMS_VENTA.xlsx`
- Cubre solo 8 de las 13 operaciones (AASI, CDLAO, CDL28, GBADC, GBGOL, GBSRQ, GBCRP, GBCFR)

### MongoDB (colecciones y scripts de importación)

| Colección | Script | Fuente | Frecuencia |
|-----------|--------|--------|------------|
| Item | `scripts/syncItems.js` (vía `sync-items.bat`) | data/*ADICIONALES.xlsx | diario |
| ItemVenta | `scripts/syncItems.js` (vía `sync-items.bat`) | data/EBC ITEMS_VENTA.xlsx | diario |
| CompraPareto / CompraRoc | `scripts/importCompras.js` | EBC COMPRAS HISTORICAS.xlsx | semanal |
| ComparativoOC | `scripts/importComparativoOC.js` | COMPARATIVO OC INGRESOS.xlsx | diario |
| VentasTip | `scripts/importVentasTip.js` | EBC VENTAS TIP RESUMEN.xlsx | diario |
| KardexBajaVenta | `scripts/importBajas.js` | data/*ADICIONALES.xlsx | diario |

- Sync manual de items desde consola del navegador (admin logueado), si se necesita fuera del horario del bat:
```javascript
(async () => {
  const ops = ['AASI','CDLAO','CDL28','PLANTA','GBADC','GBCFR','GBCFR2','GBCRP','GBGOL','GBSRQ','GBPLANTA'];
  for(const op of ops) {
    const r = await fetch(`/api/items/sync?operacion=${op}`, {method:'POST', headers:{Authorization:'Bearer '+localStorage.getItem('ebc_token')}});
    console.log(op, JSON.stringify(await r.json()));
  }
})();
```

## Tarea programada diaria — CORPSERV-PRUEBA

**Tarea**: `EBC Actualizacion Diaria` — 6:00 AM diario  
**Comando**: `cmd.exe /c "C:\pedidos-app\sync-master.bat >> C:\pedidos-app\scripts\sync-master.log 2>&1"`  
**Log**: `C:\pedidos-app\scripts\sync-master.log`

### sync-master.bat — pasos en orden

| # | Bat | Qué hace |
|---|-----|----------|
| 1 | `sync-excel.bat` | Copia 11 ADICIONALES de Box → `data\` + git push |
| 2 | `sync-oc-ingresos.bat` | `python D:\Comparativo_OC\actualizar_oc_ingresos.py` |
| 3 | `sync-comparativo.bat` | `importComparativoOC.js` → MongoDB |
| 4 | `sync-ventas.bat` | `importVentasTip.js` → MongoDB |
| 5 | `sync-bajas.bat` | `importBajas.js` → MongoDB |
| 6 | `scripts\ejecutar-importacion.bat` | `importCompras.js` → MongoDB |
| 7 | `sync-items.bat` | `syncItems.js` → MongoDB (colección Item) |

> **Para agregar una nueva consulta**: crear `sync-nueva.bat` + agregar paso `[N/X]` en `sync-master.bat` antes del bloque de Resumen. Los bats hijos solo hacen `echo` a stdout (sin `>>` internos); el master redirige todo al log con una sola apertura externa.

**Problema recurrente en git pull del servidor**: si `sync-master.bat` u otro bat tiene cambios locales:
```cmd
git checkout -- sync-master.bat
git pull origin main
```

## Flujo de sincronización Excel → DigitalOcean

1. Correr `sync-excel.bat` en servidor CORPSERV-PRUEBA (carpeta `C:\pedidos-app\`)
2. El bat copia xlsx de Box a `data\`, hace `git add data\`, `git commit`, `git push`
3. DigitalOcean detecta el push y redespliega en 1-2 minutos

**Problema recurrente**: el servidor tiene `sync-excel.bat` modificado localmente → conflicto en git pull. Solución:
```powershell
cd C:\pedidos-app
git checkout -- sync-excel.bat
git pull origin main --no-edit
```

## Estructura de navegación

- **Sidebar** (desktop): nav items + footer con Comentarios / Cambiar contraseña / Salir
- **Bottom nav** (móvil ≤768px): mismos nav items + botón ↺ (hard refresh) fijo a la derecha
- **Comentarios**: SOLO en footer del sidebar, NO aparece en el nav principal ni en bottom nav

## Form de mantenimiento de usuarios

- **Operaciones asignadas**: checkboxes de las 13 operaciones (visible para todos los no-admin)
- **Sociedades de Compra**: checkboxes ERSAC / FRQ1 / GB al mismo nivel que Operaciones
- **Permisos de Consulta** (recuadro azul): SOLO visible para rol OPERADOR_CONSULTA
  - Kardex ✅
  - Precios de Compra ✅ (activa las sociedades seleccionadas arriba)
- Para ADMIN: no se muestran Operaciones ni Sociedades ni Permisos

## Form de mantenimiento de usuarios — Permisos de Consulta

Recuadro azul, solo visible para rol `OPERADOR_CONSULTA`:
- Kardex (`puedeVerKardex`)
- OC / Ingresos al Almacén (`puedeVerComparativo`)
- Venta / TIP por Operación (`puedeVerVentas`)
- Seguimiento de Bajas (`puedeVerBajas`)
- Precios de Compra — activa las Sociedades Autorizadas (`puedeVerKardex` con `sociedadesCompra`)

## Cambios implementados (historial completo)

### Sesión 1
- Branding login: "EBC" / "EL BIEN COMÚN"
- Bottom nav móvil con botón hard refresh (↺)
- Botón Comentarios en footer sidebar (encima de Cambiar contraseña)
- Item no catalogado en solicitar: flag `esItemNuevo`, requiere descripción y costo unitario
- `readCostos()` detecta columna COSTO dinámicamente desde cabecera
- Bulk upsert en `/api/items/sync` (evita timeout 504)
- Kardex usa `/datos/items` (Excel) para autocomplete, no MongoDB
- 12 operaciones nuevas agregadas con su Excel y en sync-excel.bat

### Sesión 2
- Comentarios removido del nav principal, solo en footer sidebar
- Form usuario rediseñado: Sociedades top-level, Permisos de Consulta solo para CONS
- GBPLANTA agregada (operación 13), PREP movida después de DOSIMETRIA
- Fix sync-excel.bat en servidor: resolver conflicto con `git checkout -- sync-excel.bat`
- CLAUDE.md creado para continuidad de sesiones

### Sesión 3
- Precios de Compra: fix filtro operacion en routes/compras.js (eliminado — acceso por sociedad)
- Endpoint diagnóstico `/api/compras/muestra` para debug de datos importados
- Venta & TIP: vista con tabs Evolución / Por Sede, granularidad Semanal/Mensual
  - Modelo `VentasTip` con campos `añoN`, `mesN`, `añomes` para agrupación mensual
  - `importVentasTip.js` lee columnas AÑO_N y MES_N del Excel
  - Rutas: `/evolucion`, `/evolucion-mes`, `/por-sede`, `/por-sede-mes`
  - "Ver todo" incluye % TIP; vista renombrada a "Venta & TIP"
- Bajas: nueva vista Seguimiento de Bajas (BAJA vs VENTA del Kardex ADICIONALES)
  - Modelo `KardexBajaVenta`, script `importBajas.js`, ruta `/api/bajas`
  - Tabs Evolución semanal / Por Ítem, KPI % Baja/Venta coloreado
  - Permiso `puedeVerBajas` en User model y form de usuarios
- Tarea programada `EBC Actualizacion Diaria` en CORPSERV-PRUEBA
  - `sync-master.bat` ejecuta los 6 pasos en secuencia
  - Log único en `scripts\sync-master.log` (redirección externa, sin locks)

### Sesión 4
- Nuevo módulo **Bajas / Consumos / Transferencias / 86** (`/api/movimientos`, vista `viewMovimientos`)
  - Modelo `Movimiento` (un solo modelo para los 4 flujos, campo `flujo` discrimina)
  - Permisos por usuario: `rolBCT` (Solicitud/Registro/Consulta), `rol86` (Registro/Consulta),
    `accesoBajas`/`accesoConsumos`/`accesoTransferencias`/`acceso86`
  - Paso 7 de `sync-master.bat` (`sync-items.bat` → `syncItems.js`)
- Fix dropdown de búsqueda de Ítem en Movimientos: usaba `position:absolute` y quedaba clipeado
  por el contenedor `overflow-x:auto` de la tabla; ahora `position:fixed` con coordenadas
  calculadas vía `getBoundingClientRect()`
- Catálogo **ItemVenta** (`EBC ITEMS_VENTA.xlsx`, colección `ItemVenta`) para el flujo 86:
  - Solo cubre 8 de las 13 operaciones; `GET /api/items/venta?operacion=` filtra por operación
  - `buscarNombreItem()` en `routes/movimientos.js` usa `ItemVenta` para 86 e `Item` para el resto
  - Sync incluido en `scripts/syncItems.js` (dedup por `operacion|item`, último gana)
- Rediseño de columnas de la tabla de Movimientos (4 flujos): columnas Fecha/Operación
  (+Destino para Transferencias) separadas, Estado+Creado por combinados, Ítem a 330px
  (+50%) y Comentarios a 450px (x2); clase `.mv-table` agrega `padding-right:24px` entre
  columnas (ancho de "MMM"); botón "+ Nuevo" junto a "Buscar" (sin `margin-left:auto`)

### Sesión 5 — Cierre de Caja
Nuevo módulo para controlar el movimiento de efectivo en operaciones tipo restaurante
(mesas/mozos) o mostrador (venta directa). Cadena de custodia en 3 etapas:

```
Cierre de Caja (diario) → [Envío a Oficina] → Depósito Bancario
```

- **Solo el efectivo contado (físico) viaja** por la cadena; tarjeta/delivery(CxC)/transferencia
  se registran en el Cierre solo para reporte, no generan envío ni depósito.
- Cada combinación **venta/propina × PEN/USD** (4 "combos") tiene su propio estado
  (`PENDIENTE` → `EN_OFICINA` → `DEPOSITADO`) para no enviar/depositar el mismo efectivo dos veces.
  Operaciones sin oficina saltan directo `PENDIENTE` (en Cierre) → `DEPOSITADO`.
- Los depósitos/envíos son por **días completos**: se seleccionan Cierres (o Envíos) enteros,
  nunca una fracción de un día.

**Modelos** (`models/`):
- `CajaConfig` — `{ operacion, tipoNegocio: RESTAURANTE|MOSTRADOR, tieneOficina }`, configurable
  por admin en `Admin → 🧾 Cierre de Caja`.
- `CierreCaja` — `{ operacion, fecha, cobranzas: {efectivo,tarjeta,delivery,transferencia} cada uno
  con {ventaPEN,ventaUSD,propinaPEN,propinaUSD}, efectivoContado (conteo físico), estadoEfectivo,
  estado: ABIERTO|CERRADO }`. Único por `operacion+fecha`.
- `EnvioOficina` — `{ operacion, fecha, cierres: [{cierreId,fecha}], montos, montosRecibidos,
  estadoEfectivo, estado: ENVIADO|RECIBIDO }`.
- `DepositoBancario` — `{ operacion, fecha, moneda, tipo: VENTA|PROPINA, monto, origenTipo:
  CIERRE|ENVIO, origenes: [{id,fecha,monto}] }`.

**Backend** (`routes/caja.js`, montado en `/api/caja`):
`GET/PUT /config(/:operacion)`, `GET /operaciones`, `GET/POST/PUT/DELETE /cierres(/:id)`,
`GET /disponible-envio`, `GET/POST /envios`, `PUT /envios/:id/recibir`,
`GET /disponible-deposito`, `GET/POST /depositos`. Acceso por `rolCaja` (REGISTRO/CONSULTA),
`accesoOficina`, `accesoDepositos` — todos boolean/enum en `User`, scoped por `operations`.

**Frontend** (`public/app.js`): nav `caja` → `viewCierreCaja` con 3 tabs (Cierres/Envíos/Depósitos,
visibles según permiso). Funciones globales prefijo `cj*` y estado módulo-level `_cj*`
(mismo patrón que `_dgls*` de Genera Adicional).

**Refinamientos posteriores**:
- Conteo de Apertura/Cierre por denominación (billetes/monedas, PEN y USD): `CierreCaja.conteoApertura/
  conteoCierre` (`Mixed`, `{denom: qty}`), helpers `cjDenomTableHtml/cjDenomListener/cjDenomTotal/
  cjDenomValores`. La apertura se registra una sola vez (`aperturaRegistrada`, el PUT nunca la acepta)
  y se hace en un **paso previo separado**: `cjAbrirFormApertura` (solo conteo + botón "Grabar Apertura")
  crea el `CierreCaja` vía POST y abre `cjAbrirFormCompleto` (cobranzas/cierre/enviado a oficina/
  comentarios) — la apertura nunca se vuelve a mostrar. `cjAbrirFormCierre` solo enruta entre ambos
  según si hay `existente`. Modal del formulario completo usa ancho `medium` (66vw, clase `.modal-medium`).
- **Turnos**: `CajaConfig.turnos` (array, definible por operación en `Admin → Cierre de Caja`, input
  separado por comas) + `CierreCaja.turno`. Permiten varias cajas por día (una por turno) pero nunca
  simultáneas: `POST /cierres` rechaza abrir un turno si ya hay otro `ABIERTO` en esa operación. Índice
  único cambió de `{operacion,fecha}` a `{operacion,fecha,turno}` (migrado en prod con
  `scripts/migrarTurnosCaja.js`, ya ejecutado — no volver a correr salvo nueva migración de índice).
- **Eliminar cierres**: `DELETE /caja/cierres/:id` ya permitía ADMIN sin restricción (bloquea a
  no-admin si el efectivo ya se movió); botón 🗑️ en la tabla de Cierres solo visible para ADMIN.

### Sesión 6 — Conciliación de Cobranzas (efectivo, en construcción)

Nuevo módulo para conciliar cobranzas registradas vs. lo que ingresa al banco. Por **Sociedades
Autorizadas** (reutiliza `ALL_SOCS_COMPRA`: ERSAC, FRQ1, GB, MUVON, QUIASMO, FACTORIAL K). Primera
etapa: conciliación de efectivo (tarjetas/transferencias se harán después con `Q TC.xlsx`).

**Archivos fuente** (uno por sociedad, configurables en `Admin → Conciliación Cobranzas`):
- `rutaEECC` — `Q EECC BANCOS.xlsx`, una hoja por banco+moneda (ej. `Q_BBVA_SOL`, `Q_BBVA_DOL`),
  columnas: `F. Operación, F. Valor, Código, Nº. Doc., Concepto, Importe, Oficina, BANCO, MONEDA`.
  Un solo archivo cubre soles y dólares (no hace falta separar por moneda).
- `rutaCobranza` — `Q COBRANZA.xlsx` con 2 hojas:
  - `COBRANZA ERP`: `DOCUMENTO, FECHA COBRANZA, MEDIO PAGO, OTRO MEDIO DE PAGO, TC, TARJETA,
    TIPO DE CAMBIO, COBRANZA MONEDA, MONEDA, VENTA, TIP, COBRANZA`. `MEDIO PAGO` ∈ {Efectivo,
    Tarjeta de Crédito, Cheque, Varios}; `MONEDA` ∈ {Soles, Dolares}.
  - `CAJA`: `FECHA, COBRANZA EFECTIVO, TIP EFECTIVO, TIP EFECTIVO CMZ, TIP FACT, TIP FACT CMZ,
    VUELTO EN SOLES, DEPOSITO PEN, COBRANZA EFECTIVO USD, TIP USD, DEPOSITO USD`. `DEPOSITO PEN/USD`
    es disperso (solo aparece el día que se hizo un depósito) y ya viene en negativo.
- `rutaTC` — `Q TC.xlsx` (hoja `Q TC TODAS`), pendiente de usar en la conciliación de tarjetas.

**Modelos** (`models/`): `ConciliacionConfig` (rutas por sociedad), `EeccMovimiento`, `CobranzaErp`,
`CajaDiaria`. Import: `scripts/importConciliacion.js` (`sync-conciliacion.bat`, paso 11/11 de
`sync-master.bat`) — recorre cada `ConciliacionConfig`, hace `deleteMany({sociedad})` + reinserta.

**Backend** (`routes/conciliacion.js`, montado en `/api/conciliacion`). Acceso: `accesoConciliacion`
(boolean) + `sociedadesConciliacion` (array) en `User`, scoping igual a `sociedadesCompra`.
- `GET/PUT /config(/:sociedad)` — rutas de archivos (solo ADMIN).
- `GET /sociedades` — sociedades con config, filtradas por `sociedadesConciliacion` si no es ADMIN.
- `GET /check1` — por día, `COBRANZA ERP` (solo `MEDIO PAGO=Efectivo`) sumado por moneda vs.
  `CAJA.COBRANZA_EFECTIVO` / `COBRANZA_EFECTIVO_USD`. Ambos deben coincidir (confirmado con datos
  reales: coinciden la mayoría de los días, las diferencias son reales y deben investigarse).
- `GET /check2` — valida que `DEPOSITO_PEN`/`DEPOSITO_USD` (cuando aparece) sea igual a la suma de
  `COBRANZA_EFECTIVO + TIP_EFECTIVO (+ VUELTO_EN_SOLES, ya negativo)` de uno o varios días
  **consecutivos** hacia atrás — probando primero incluyendo el día del depósito, luego solo desde
  el día anterior (`matchDeposits` en `routes/conciliacion.js`, ventana `MAX_LOOKBACK=20` días,
  tolerancia `TOL=0.5`). Los días ya consumidos por un depósito no se reutilizan en el siguiente.
- `GET /check3` — por cada depósito de CAJA se agrupan **TODOS** los movimientos EECC con
  `Concepto = "INGRESO EN EFECTIVO"` (confirmado que existe tal cual en el archivo real) que caen
  dentro de la ventana `[fecha del depósito, +MAX_DIAS_BANCO=6 días]` (no se busca un monto exacto:
  se suman todos los candidatos de la ventana y se compara el total contra el depósito). El
  frontend muestra el desglose completo de movimientos agrupados por depósito, con un botón
  "✕" por movimiento para excluirlo manualmente del grupo si quedó mal agrupado (persistido en
  `ConciliacionExclusionEECC`, único por `sociedad+eeccMovimientoId`, vía `POST/DELETE
  /conciliacion/eecc-excluir`) — un movimiento excluido deja de sumarse en cualquier depósito y
  pasa a la lista de pendientes. Los movimientos con ese concepto que ningún depósito reclamó (o
  que se excluyeron a mano) **no se mezclan** con las filas diarias — `agruparEnBanco()` los
  devuelve aparte (`pendientesEecc`), y el frontend los lista en una tabla separada al final de la
  sección (Soles/Dólares), no fusionados en las filas de depósito. Internamente usa
  `calcularCheck3()` (compartida con check4) y `agruparEnBanco(depositos, eeccRows, claimed,
  excluidos)` — el `Set claimed` se pasa explícitamente para que **un movimiento del EECC solo
  pueda pertenecer a UNA conciliación**: se consulta y se llena *durante* cada búsqueda (no solo
  después), y check4 recalcula check3 para heredar el mismo `usadosSol`/`usadosUsd` antes de
  buscar los suyos.
- `GET /check4` — Eventos Comerciales: `COBRANZA ERP` con `MEDIO PAGO = "Cheque"` no pasa por CAJA,
  se busca directamente en el EECC por **importe único** (`cobranzaMoneda`, ya que en la data real
  TIP siempre es 0 para Cheque), excluyendo `INGRESO EN EFECTIVO` y cualquier movimiento ya usado
  por check3. Ventana `MAX_DIAS_EVENTO=15` días (más amplia que check3, ya que transferencias/cheques
  de eventos pueden demorar más en aparecer). No hay un `Concepto` de banco identificable para estos
  pagos (se revisaron: nombres de empresas, "ABONO INMEDIATO", "TIN00X...", sin patrón común), así que
  la única señal confiable es el monto — por eso depende de que los importes de eventos no se repitan.
- `GET /check5` — Tarjeta de Crédito: `COBRANZA ERP` con `MEDIO PAGO = "Tarjeta de Crédito"` y
  `TC` ∈ {IZIPAY, NIUBIZ, AMEX, DINERS} (case-insensitive) vs `TcMovimiento` (import de `Q TC.xlsx`,
  hoja `Q TC TODAS`). Llave de conciliación: `TARJETA` (4 dígitos en COBRANZA, rellenados con
  `padStart(4,'0')` al importar — a veces pierde el cero inicial en Excel, ej. "567" en vez de
  "0567") == últimos 4 dígitos de `TARJETA` en Q TC (`TcMovimiento.tarjetaUlt4`) + `FECHA VENTA`
  de Q TC dentro de `MAX_DIAS_TC=5` días de `FECHA COBRANZA` (no siempre coinciden exacto, confirmado
  con casos reales) + mismo monto (tolerancia `TOL=0.5`). **El monto a comparar es
  `CobranzaErp.cobranza` (VENTA+TIP), no `cobranzaMoneda`** — `Q TC.VENTA` incluye la propina;
  confirmado con datos reales (usar `cobranzaMoneda` daba 434/4689 matches, `cobranza` da ~3200/4689
  con la ventana de fechas). El campo `TC` no se usa como parte de la llave: los nombres de operador
  no coinciden entre ambos orígenes (COBRANZA usa IZIPAY/NIUBIZ/AMEX; Q TC usa NIUBIZ/DINERS
  NIUBIZ/CMD DINERS/AMEX/VISA MC/ALIMENTACION — sin mapeo 1:1 confiable).
  **2da pasada (combinados)**: un solo movimiento de Q TC puede ser la suma de varias cobranzas de
  la misma tarjeta+fecha que el operador liquidó juntas — si una cobranza no matchea individualmente,
  se agrupa con otras sin match de la misma tarjeta+fecha y se busca un Q TC cuyo `VENTA` sea igual
  a la suma del grupo (marcado `combinado:true`, mostrado como "🔗 (combinado)" en el frontend).
  Solo cruza contra Q TC (aún no contra el EECC). **`DEPOSITO`/`FECHA DEPOSITO` de Q TC se reserva
  para una etapa siguiente** (verificar que el fondo entró al banco) — NO se usa para conciliar
  COBRANZA vs TC (se probó usarlo como llave de fecha y da resultados muy pobres: 5/4689 vs
  ~3200/4689 con `FECHA VENTA`).
  **Ventanas**: `MAX_DIAS_TC_TARJETA=15` para las pasadas 1 y 2 (exigen misma tarjeta, más
  confiables); `MAX_DIAS_TC_FALLBACK=5` para la pasada 3 (más conservadora al no exigir tarjeta).
  **3ra pasada (solo importe+fecha)**: si una cobranza sigue sin match (ni individual ni
  combinado), se busca en Q TC SOLO por importe+fecha, sin exigir la misma tarjeta — cada
  movimiento de Q TC solo puede conciliar UNA cobranza (mismo `Set usados` compartido entre
  las 3 pasadas). Se marca `soloImporteFecha:true`; el frontend muestra ambas tarjetas
  (COBRANZA y Q TC) lado a lado en amarillo para verificación visual, ya que no necesariamente
  coinciden. Los movimientos de Q TC que ni así logran conciliar con ninguna cobranza se listan
  aparte en `pendientesTc` (tabla debajo de la principal en el frontend).
  **Conciliación manual** (`models/ConciliacionManualTC.js`, único por `sociedad+documentoCobranza`):
  para cobranzas que ninguna pasada automática concilia, el usuario elige a mano un movimiento
  de `pendientesTc` (dropdown) y lo guarda vía `POST /conciliacion/tc-manual`. Se aplica ANTES
  de las 3 pasadas automáticas en `matchTC` (recibe un `Map` de overrides), así el TC elegido
  queda reservado. Solo debe usarse entre registros que ninguna pasada automática logró
  conciliar (no libera ni reasigna conciliaciones automáticas existentes). Se puede deshacer con
  `DELETE /conciliacion/tc-manual/:documentoCobranza`. Filas conciliadas así muestran 🖐️.

**Frontend**: nav `conciliacion` → `viewConciliacion` (selector sociedad + rango de fechas, 6
tarjetas de reporte con badges ✓/⚠ por fila). Admin: tab `🏦 Conciliación Cobranzas` →
`renderAdminConciliacion` (inputs de ruta por sociedad, guardado on-change vía `PUT /config/:sociedad`).
La UI para CREAR conciliaciones manuales de TC (dropdown + checkbox) se quitó a pedido del
usuario; el botón para eliminar una manual existente y el backend (`ConciliacionManualTC`,
`POST`/`DELETE /tc-manual`) siguen activos.

**Modelo `TcMovimiento`** (`models/TcMovimiento.js`): import vía `rutaTC` en `ConciliacionConfig`
(mismo patrón multi-archivo que EECC/Cobranza). Columnas de `Q TC.xlsx` (hoja `Q TC TODAS`, 14
columnas — la versión anterior traía 3 de más que ya no existen: `EMISOR`, `Neto_Parcial`,
`Fecha y Hora de Operación`): `ESTABLECIMIENTO, TARJETA, FECHA VENTA, VENTA, ESTADO,
COMISION MERCHANT, COMISION EMISOR, IGV COMISION, DEPOSITO, FECHA DEPOSITO, COMISION TOTAL, TC,
AUTORIZACION, MONEDA`.
- `ESTADO` ∈ {SEA, ABONADO, PROCESADO}.
- `TARJETA` viene enmascarada (ej. `0484-3527`); `tarjetaUlt4` = últimos 4 caracteres, calculado
  al importar para conciliar contra `CobranzaErp.tarjeta` (que ya viene como solo 4 dígitos).
- `MONEDA` casi siempre vacía o `Soles`/`SOLES` — no se usa aún para filtrar (todas las cobranzas
  con Tarjeta de Crédito verificadas están en Soles).

- `GET /check6` — Depósitos de Operadores de TC: compara, **por día**, el total de
  `TcMovimiento.deposito` agrupado por `FECHA DEPOSITO` (`ymd(fechaDeposito)`) contra el total de
  movimientos EECC positivos cuyo `Concepto` contiene alguna de estas subcadenas (confirmado en
  data real, no hay un concepto único/exacto): `DINERS`, `COMPAÑIA PERU`, `PROCESOS DE ME`,
  `COMPAÑIA DE SE` (`CONCEPTO_DEPOSITO_TC`). No es matching 1:1 como los checks anteriores, es
  una **suma diaria** en cada lado — no requiere ni comparte el `Set usados` con check3/check4
  (concepts disjuntos). `TcMovimiento.moneda` casi nunca viene poblada (data real: 0 filas
  "Dolares"), así que el total de TC se separa Soles/Dólares por ese campo (blanco = Soles) para
  no comparar el total contra el lado de dólares y marcar error en todos los días. Se probó
  alinear por desfase de fecha (±2 días) y no mejora el match — las diferencias que salgan son
  reales, no un problema de desfase. El frontend muestra, además del total por día, el desglose
  de los movimientos individuales que forman esa suma en dos columnas (`movimientosTc` /
  `movimientosEecc`, devueltos por `compararPorDia()`), para poder ver a simple vista qué
  operación de TC o qué movimiento del banco explica una diferencia.
