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

## Sociedades y Operaciones

Ya **no** son listas fijas en código — viven en las colecciones `Sociedad`
(`models/Sociedad.js`, `{codigo, nombre}`) y `Operacion` (`models/Operacion.js`,
`{codigo, nombre, sociedadCodigo}`, cada operación pertenece a una sociedad). Se
administran desde **Admin → Sociedades y Operaciones** (`routes/sociedades.js`,
`GET/POST/PUT/DELETE /api/sociedades[...]`).

El frontend (`public/app.js`) hace `GET /api/sociedades` al iniciar sesión
(`loadSociedades()`, llamado desde `showApp()`) y puebla `ALL_OPS`/`ALL_SOCS_COMPRA`
(ahora `let`, no `const`) con lo que venga de la base — cualquier sociedad u operación
nueva se agrega desde esa pantalla de Admin, sin tocar código.

Mapeo sociedad → operación cargado en el seed inicial
(`scripts/seedSociedadesOperaciones.js`, correr una sola vez tras el primer deploy):
- **GB**: GBGOL, GBADC, GBSRQ, GBCFR, GBCRP, GBPLANTA, GBCORP
- **ERSAC**: (sin operaciones propias)
- **MUVON**: MUVON
- **QUIASMO**: AASI, CORPQ
- **FACTORIAL K**: CDLAO, CORPFK, PLANTA
- **FRQ1**: CDL28

En **Admin → Usuarios**, ya no se marcan "Operaciones Autorizadas" y "Operaciones
Destino para Transferencias" por separado: se elige la(s) **Sociedad(es)** del usuario
y `operations`/`transferenciaDestinos` se derivan automáticamente como la unión de
todas las operaciones de esas sociedades (ver `showUserModal` en `public/app.js`).

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
- `puedeVerPronosticoVenta`: boolean — acceso a Pronóstico de Venta (scoped por `operations`, igual que `puedeVerVentas`)
- `puedeVerCosteoRecetas`: boolean — acceso a Costeo de Recetas (scoped por `operations`, igual que `puedeVerVentas`)
- `rolSeguimientoCompras`: '' | carga | aprobacion | consulta | admin — acceso a Aprobación y Seguimiento de Compras (scoped por `operations`, ver Sesión 8)
- `puedeVerBajas`: boolean — acceso a Seguimiento de Bajas
- `sociedadesCompra`: array — sociedades para ver Precios de Compra (códigos del catálogo `Sociedad`, ver sección "Sociedades y Operaciones")
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
| VentaCanalDiaria | `scripts/importVentaCanalDiaria.js` (vía `sync-venta-canal.bat`) | EBC VENTAS CABECERA.xlsx | diario |
| KardexBajaVenta | `scripts/importBajas.js` | data/*ADICIONALES.xlsx | diario |
| MaestroLinea/Familia/SubFamilia/TipoItem/UM/Item/ItemSociedad | `scripts/importMaestroTablas.js` | EBC TABLAS PARA ITEMS.xlsx | manual (al actualizar el Excel) |
| MaestroCuenta | `scripts/importPlanContable.js` | EBC PLAN CONTABLE.xlsx | manual (al actualizar el Excel) |
| RecetaCosteo / RecetaCosteoDetalle | `scripts/importRecetasCosteo.js` (vía `sync-recetas-costeo.bat`) | EBC RECETAS.xlsx | diario |
| SeguimientoCompraMovimiento / SeguimientoCompraOC | `scripts/importSeguimientoCompras.js` (vía `sync-seguimiento-compras.bat`) | EBC BASE SEGUIMIENTO DE COMPRAS.xlsx (hojas MOVIMIENTOS/OC) | diario |
| FlujoMovimientoBancario / FlujoPagoERP | `scripts/importFlujoCaja.js` (vía `sync-flujo-caja.bat`) | Carpeta "EBC ESTADO DE CUENTA" (un .xlsx por sociedad+banco+moneda) + carpeta "EBC PAGOS ERP" (.csv, todas las sociedades), rutas globales en `Config` | diario |
| TipoCambio | `scripts/syncTipoCambio.js` (vía `sync-tipo-cambio.bat`, paso 17/17 de `sync-master.bat`) | API pública SUNAT `https://api.apis.net.pe/v1/tipo-cambio-sunat?fecha=YYYY-MM-DD` (sin API key), campo `venta`. Rellena desde la fecha del movimiento más antiguo en `FlujoMovimientoBancario` hasta hoy, saltando fechas ya cargadas (idempotente) — usado por Flujo de Caja para "Todo en Soles". Sensible a rate-limit 429; reintenta con backoff. | diario |

> `RecetaCosteo`/`RecetaCosteoDetalle` (módulo **Costeo de Recetas**, costo de receta vs.
> costo real de producción) es distinto del modelo `Receta` existente (`models/Receta.js`,
> `routes/recetas.js`, montado en `/api/recetas`) — ese otro es el desglose recursivo de
> recetas de planta desde `EBC JERARQUIA.xlsx`, usado en "Solicitud de Adicionales desde
> Desglose". Nombres separados a propósito para no chocar.

`scripts/importar-maestro-items.bat` corre ambos scripts en orden (con sus rutas de Box
por defecto) — **no está en `sync-master.bat`**: ambos scripts hacen `deleteMany` +
`insertMany` completo, así que automatizarlos a diario borraría los ítems creados vía el
flujo de solicitudes de la app. Se ejecuta a mano en `C:\pedidos-app` solo cuando se
actualiza alguno de los 2 Excel de origen.

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
- `GET /check3` — por cada depósito de CAJA se agrupan los movimientos EECC con
  `Concepto = "INGRESO EN EFECTIVO"` (confirmado que existe tal cual en el archivo real) que caen
  dentro de la ventana `[fecha del depósito, +MAX_DIAS_BANCO=6 días]`, **día por día**: se toman
  los candidatos del día más cercano, se suman, y si esa suma ya concilia con el depósito
  (`±TOL_DIA_BANCO=1`) se detiene ahí — no sigue tomando días más lejanos solo porque caen dentro
  de la ventana. Solo si el día (o los días) más cercanos no alcanzan a conciliar, sigue sumando
  el siguiente día disponible. El frontend muestra el desglose completo de movimientos agrupados por depósito, con un botón
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
  `COMPAÑIA DE SE`, `ABONO VISANET` (`CONCEPTO_DEPOSITO_TC`). No es matching 1:1 como los checks anteriores, es
  una **suma diaria** en cada lado — no requiere ni comparte el `Set usados` con check3/check4
  (concepts disjuntos). `TcMovimiento.moneda` casi nunca viene poblada (data real: 0 filas
  "Dolares"), así que el total de TC se separa Soles/Dólares por ese campo (blanco = Soles) para
  no comparar el total contra el lado de dólares y marcar error en todos los días. Se probó
  alinear por desfase de fecha (±2 días) y no mejora el match — las diferencias que salgan son
  reales, no un problema de desfase. `compararPorDia()` agrupa por **grupos fijos**
  (`GRUPOS_CHECK6`), cada uno emparejando el o los operadores de TC (campo `tc`) que en
  realidad liquida el mismo banco detrás de una categoría de EECC: `DINERS NIUBIZ↔DINERS`,
  `AMEX↔COMPAÑIA DE SE`, `NIUBIZ↔COMPAÑIA PERU+ABONO VISANET`,
  `ALIMENTACION+CMD DINERS+VISA MC↔PROCESOS DE ME`. Un operador o categoría que no calce con
  ningún grupo cae en un grupo catch-all `OTROS` (que solo se incluye en la respuesta si tiene
  datos — evita columnas vacías si otra sociedad usa exactamente estos mismos nombres). Del
  lado TC cada operador tiene su **propia columna** (`grupo.operadores` nombra las columnas,
  `filas[].grupos[i].porOperador` trae el total de cada una, en el mismo orden); del lado EECC
  las categorías de un grupo se siguen sumando juntas en una sola columna `eecc`. No se guarda
  ni se muestra el detalle por movimiento — solo totales. Cada fila trae también
  `tc`/`eecc`/`diferencia` (todos los grupos juntos) — `diferencia = EECC - TC` (no al revés).
  El frontend arma columnas dinámicas por operador dentro de cada grupo, más EECC/Dif. por
  grupo y la Diferencia Total a la derecha de todo. Las diferencias positivas se muestran en
  negro, solo las negativas (`≤ -1`) en rojo.

- `GET /check7` — % Comisión y % IGV cobrados por cada operador de TC, **por mes**: filas =
  año-mes (según `TcMovimiento.fechaVenta`), columnas = operador (campo `tc`). No es una
  conciliación (no compara contra otra fuente), es un reporte de tarifas cobradas.
  `% Comisión = COMISION_TOTAL / VENTA`, `% IGV = IGV_COMISION / COMISION_TOTAL` — ambos
  agregados sumando `venta`/`comisionTotal`/`igvComision` del mes+operador antes de dividir
  (no promedio simple de porcentajes por transacción). Devuelve `null` si el denominador es 0
  (se muestra "—" en vez de dividir por cero). Incluye una columna TOTAL por mes (todos los
  operadores juntos, mismo cálculo agregado).

### Sesión 7 — Pagos Recurrentes (eliminado por completo en la Sesión 13)

Módulo para controlar pagos recurrentes (electricidad, agua, internet, etc.) por
operación, con todo ingresado a mano desde la UI (sin archivos externos). **Se borró
por completo en la Sesión 13** (código y datos, a pedido del usuario) — ver esa sección.
Los modelos `PagoRecurrenteTipo`, `PagoRecurrenteRegla` y `PagoRecurrenteProgramacion`
(y sus colecciones en Mongo), la ruta `/api/pagos-recurrentes` y el permiso
`rolPagoRecurrente` ya no existen.

### Sesión 8 — Aprobación y Seguimiento de Compras (v1, reemplazada en Sesión 10)

Primera versión: Cuadro 1 (aprobación de OC por familia, con Pedido Tienda manual y
snapshot de OC Aprobada) + Cuadro 2 (resumen semanal venta/costo). **Se borró por
completo en la Sesión 10** — ver esa sección para el diseño actual. Los modelos
`SeguimientoCompraOC`, `SeguimientoCompraPedidoTienda` y `SeguimientoCompraAprobacion`
(y sus colecciones en Mongo) ya no existen.

### Sesión 9 — Flujo de Caja (reconstrucción completa)

El módulo anterior (`routes/flujoCaja.js` viejo, 8 colecciones,
~4,786 documentos) se borró por completo — código y datos — a pedido del
usuario, para reconstruirlo con un diseño distinto. **Al hacerlo se detectó
que `models/EstadoCuenta.js` (5 docs) no era exclusivo de ese módulo** —
`routes/pagos.js` lo usa para una función propia de Gestión de Pagos
(`parsearEstadoCuenta`, `POST/GET /api/pagos/estados-cuenta`) — se restauró
de inmediato tras detectarlo por una verificación cruzada post-borrado.
Lección: al borrar un modelo compartido, grepear el nombre del **modelo**,
no solo el del módulo — un nombre genérico como `EstadoCuenta` no contiene
la palabra "FlujoCaja" y por eso no apareció en la primera búsqueda.

**Jerarquía de clasificación**: LINEA → DETALLE → SUBDETALLE → MOVIMIENTO
(4 niveles; el nivel SUBDETALLE se agregó después de la construcción
inicial, a pedido del usuario). Cada `FlujoDetalle` pertenece a una
`FlujoLinea` y tiene un `tipo` (`operacion`/`inversion`/`financiamiento`);
cada `FlujoSubdetalle` (`{codigo, nombre, detalleCodigo}`) pertenece a un
`FlujoDetalle`. Los movimientos bancarios (`FlujoMovimientoBancario`) se
asignan directamente a un `subdetalleCodigo` — LINEA y DETALLE se derivan
de ahí (`FlujoSubdetalle.detalleCodigo` → `FlujoDetalle.lineaCodigo`), no
se guardan por separado en el movimiento para no desincronizar si cambia
el catálogo. La asignación usa 3 métodos, en este orden:
1. **Glosa** (`FlujoGlosaRegla`, `{texto, criterio: exacta|contiene,
   subdetalleCodigo}`) — si la glosa del movimiento coincide, asignación
   automática directa.
2. **Cruce contra el ERP** — si el método 1 no aplicó, se agrupan los pagos
   del ERP (`FlujoPagoERP`) por `(cuentaBancaria, numeroPago)` y se suma
   `montoLocal`/`montoExtranjero` según la moneda del movimiento; si esa
   suma coincide (tolerancia `TOL_IMPORTE=1`) con el `Math.abs(importe)`
   del banco para ese mismo número de operación, se resuelve el
   beneficiario (`pagarA`) contra `FlujoProveedorDetalle` (tabla
   beneficiario→subdetalle, normalizada a mayúsculas). **El número de
   operación del banco puede venir con ceros a la izquierda (BBVA:
   `"0000004569"`) y hay que normalizarlo a entero antes de comparar contra
   `NumeroPago` del ERP** (`normNumOp()` en `utils/flujoCajaReconciliar.js`)
   — bug real encontrado y corregido durante la validación de esta sesión
   (sin la normalización, 0 cruces; con ella, ~90-96% de coincidencia
   validado contra datos reales, re-confirmado tras agregar SUBDETALLE).
3. **Manual** (`PUT /movimientos/:id/asignar`, body `{subdetalleCodigo}`)
   — para lo que ninguno de los dos métodos anteriores resolvió.

**Fuentes de datos** (rediseñado en una sesión posterior — 2 carpetas
globales en Box, ya NO una carpeta por sociedad; rutas configurables en
Admin → Flujo de Caja → Rutas, `Config` keys `flujoCajaRutaEstadoCuenta` /
`flujoCajaRutaPagosERP`, default de servidor
`C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC POSICION DE CAJA\`):
- **`EBC ESTADO DE CUENTA\`** — un `.xlsx` por sociedad+banco+moneda, con el
  nombre de archivo codificando los 3 (`"{SOCIEDAD} {BANCO} {MONEDA}.xlsx"`,
  ej. `"FACTORIAL K BBVA PEN.xlsx"` — la sociedad puede tener espacios, banco
  y moneda son siempre los últimos 2 tokens del nombre sin extensión;
  parseo en `listarArchivosEstadoCuenta()`, `utils/flujoCajaImport.js`).
  4 bancos soportados (BBVA/BCP/BN/IBK, columnas por nombre no posición).
  El archivo de BN usa celdas de **texto enriquecido** (`richText`) —
  `cellVal()` las desenvuelve. IBK tiene una inconsistencia real del propio
  banco en fechas recientes: la columna "Nro. de operación" a veces trae una
  fecha duplicada en vez del número — se descarta (`parseFechaDDMMYYYY()`).
  **Algunos exports del banco (ej. BBVA) anteponen un bloque de metadatos de
  largo variable ("Histórico de Movimientos", "Periodo: de...", "Cuenta
  Actual: ...") antes del encabezado real — `leerEncabezado()` escanea las
  primeras 25 filas buscando la que contenga una columna "señal" (ej.
  `IMPORTE` para BBVA) en vez de asumir que el encabezado está en la fila 1**
  — bug real encontrado en `"FACTORIAL K BBVA USD.xlsx"` (encabezado en la
  fila 11) durante la validación de esta sesión.
- **`EBC PAGOS ERP\`** — uno o más `.csv` (ya no `.xls` legacy) con
  **todas las sociedades juntas**, distinguidas por `CompaniaCodigo` dentro
  del archivo. Parseo CSV propio en `utils/flujoCajaImport.js`
  (`parseCSVLine`/`parseCSV`, con soporte de comas dentro de comillas, ej.
  `"JIMENEZ DIAZ, PABLO CESAR"` — mismo patrón que `parseCSV` en
  `routes/pagos.js`, duplicado a propósito). Columnas: `CuentaBancaria`
  (→ banco+moneda vía `FlujoCuentaBanco`), `NumeroPago` (para el cruce),
  `CompaniaCodigo` (→ sociedad), `PagarA`.
- **Sociedad**: en Pagos ERP sale de `CompaniaCodigo` contra la colección ya
  existente `CompaniaCodigo` (`{codigo, compania}`), rellenando a 6 dígitos
  (`padStart(6,'0')`). En Estado de Cuenta sale directo del nombre del
  archivo. **No hay operación** — se descartó a pedido del usuario.

**Modelos** (`models/`): `FlujoLinea`, `FlujoDetalle`, `FlujoSubdetalle`,
`FlujoCuentaBanco`, `FlujoMovimientoBancario` (snapshot, reemplazo completo
por `sociedad+banco+moneda` en cada import; campo de asignación es
`subdetalleCodigo`), `FlujoPagoERP` (snapshot, reemplazo completo por
`sociedad`), `FlujoGlosaRegla`, `FlujoProveedorDetalle` (ambos apuntan a
`subdetalleCodigo`). `TipoCambio` (ya existía) se reutiliza para "todo en
soles". **`FlujoConfig` (rutas por sociedad) se eliminó** — reemplazado por
2 entradas en el `Config` genérico (`{key,value}`, ya usado para SMTP, etc.).

**Backend**: `utils/flujoCajaImport.js` (parsers + `listarArchivosEstadoCuenta()`/
`listarArchivosPagosERP()`, descubrimiento de archivos por carpeta) +
`utils/flujoCajaSync.js` (capa compartida entre el sync diario y la carga
manual: `obtenerRutas()`/`guardarRutas()` sobre `Config`,
`importarArchivoEstadoCuenta()`, `importarArchivoPagosERP()` — agrupa por
sociedad y reemplaza `FlujoPagoERP` por cada una encontrada en el CSV) +
`utils/flujoCajaReconciliar.js` (sin cambios en esta sesión).
`scripts/importFlujoCaja.js` lista TODOS los archivos de ambas carpetas,
importa todo, reconcilia cada sociedad tocada (`sync-flujo-caja.bat`, paso
16/16 en `sync-master.bat`). `routes/flujoCaja.js`: `GET/PUT /config`
(global, ya no por sociedad), `GET /carga-manual/archivos` (lista lo que
hay en las 2 carpetas — a un no-admin solo le aparecen sus sociedades
autorizadas en Estado de Cuenta y nada de Pagos ERP, ya que ese archivo
mezcla todas las sociedades), `POST /carga-manual/ejecutar` (recibe la
lista de archivos elegidos y los procesa con las mismas funciones del sync
diario, luego reconcilia). **La carga manual dejó de ser "subir un archivo
desde el navegador" (multer) — ahora es "elegir con checkbox cuál de los
archivos que ya están en el servidor procesar ahora"**, a pedido del
usuario. Acceso por `rolPago`/`sociedadesPago`, igual que Gestión de Pagos.

**Frontend**: `viewFlujoCaja` sin cambios en esta sesión (selector Sociedad
+ fechas + modo Nativa/Soles, tabla LINEA→DETALLE→SUBDETALLE, sin asignar
+ Reconciliar). Admin → tab "💵 Flujo de Caja" ahora con 6 sub-secciones:
**Rutas** (2 inputs globales, ya no una tarjeta por sociedad), **Carga
Manual** (nueva — lista de checkboxes por archivo detectado en cada
carpeta + botón "📥 Cargar seleccionados", con resultado y reconciliación
mostrados inline), Líneas/Detalles/Subdetalles, Glosas, Proveedores,
Cuentas ERP↔Banco.

**Validado contra datos reales** (todas las sociedades, sesión de
rediseño): import automático completo en una sola corrida — 6 sociedades
con Estado de Cuenta (FACTORIAL K, FRQ1, GB, MUVON, QUIASMO + ERSAC solo
con Pagos ERP), 4,943 movimientos bancarios + 3,269 filas de Pagos ERP
repartidas en 6 sociedades por `CompaniaCodigo`. Cruce método 2 re-probado
con datos nuevos (7/12 pagos de un proveedor real, confirma que el
mecanismo sigue funcionando con el CSV — la tasa varía por sociedad/rango
de fechas, no es motivo de alarma). Catálogo de
Líneas/Detalles/Glosas/Proveedores sigue vacío a propósito.

### Sesión 10 — Eficiencia de Consumo y Compra de Materiales (reemplaza Sesión 8)

A pedido del usuario, se borró el Cuadro 1 (aprobación de OC por familia) y el Cuadro 2
(resumen semanal) — código, rutas y las 3 colecciones de datos que le eran propias
(`SeguimientoCompraOC`/`PedidoTienda`/`Aprobacion`, 10,351 docs borrados de OC) — y se
reemplazaron por **una sola consulta**: eficiencia de consumo/compra de materiales
contra la Venta Neta AyB, por semana. Las 2 fuentes de datos originales
(`VentaCanalDiaria` y `SeguimientoCompraMovimiento`) se mantienen sin cambios — el
import (`scripts/importSeguimientoCompras.js`, hoja `MOVIMIENTOS` únicamente, ya no
importa la hoja `OC`) y `sync-seguimiento-compras.bat` siguen igual.

**Venta Neta AyB**: se definió, a pedido explícito del usuario, como la suma de **todos**
los canales de `VentaCanalDiaria` (no hay separación AyB vs. no-AyB en la fuente) —
campo `ventaNetaMasRedencion`. Venta Bruta usa `ventaBrutaMasRedencion`. Venta Neta y
Venta Neta AyB son el mismo número (dos columnas iguales a propósito, para que el % use
siempre "Venta Neta AyB" como denominador aunque coincida con Venta Neta).

**Fórmula de Consumo Total** — validada con el usuario con un ejemplo numérico tras
varias rondas de confusión (la lectura literal de "Inv.Inicial + todos los movimientos −
Inv.Final" da 0 siempre, por construcción, ya que Inventario Final YA es Inv.Inicial +
todos los movimientos): **Consumo Total = Inv.Inicial + Ingresos al Almacén − Inv.Final**
(la fórmula clásica de costo de venta, igual que en la v1). Ejemplo confirmado:
Inv.Inicial=100, Compra=50, Inv.Final=103 (100+50−40−5−2 con Venta=−40,Consumos=−5,
Merma=−2) → Consumo Total = 100+50−103 = 47.

**Backend** (`routes/seguimiento-compras.js`, sin cambios de acceso: `rolSeguimientoCompras`,
scoped por `operations`):
- `GET /operaciones` — igual que antes, ahora sobre `SeguimientoCompraMovimiento` únicamente.
- `GET /eficiencia?operacion=&semanaObjetivo=YYYYWW&nSemanas=` — única consulta. Por cada
  semana del rango (`nSemanas`, default 8, hasta `semanaObjetivo` — default semana ISO
  actual): `calcularSemanaEficiencia(docs)` agrupa los movimientos de esa semana por tipo
  (`porTipo`) y calcula:
  - `ingresosAlmacen` = COMPRA + TRANSFERENCIA (con signo).
  - `fcTeorico` = `|VENTA|` (magnitud, la venta viene negativa en la fuente).
  - `otrosDetalle`/`otrosTotal` = todo lo demás **excepto** COMPRA/TRANSFERENCIA/VENTA/
    INICIAL (BAJA, CONSUMOS, CONSUMO TRANSFORMACION, FALTANTE, PRODUCCION, SOBRANTE,
    TRANSFORMACION en los datos reales — el set exacto varía por operación, se calcula
    dinámicamente, no está hardcodeado).
  - `inventarioFinal` = saldo corrido real = `saldoInicialSemana + totalTodos` (TODOS los
    movimientos de la semana, incluido cualquier INICIAL que caiga dentro de ella — mismo
    patrón que la v1: INICIAL no se lista como "movimiento" pero sí afecta el saldo).
  - `consumoTotal` = `saldoInicialSemana + ingresosAlmacen − inventarioFinal`.
  - `%` (solo en Ingresos al Almacén, FC Teórico y Consumo Total) = importe / Venta Neta
    AyB de esa semana. Sin acumulado de 4 semanas esta vez (no se pidió).
  - El saldo inicial de la primera semana mostrada (`saldoInicialBase`) se calcula sumando
    **todo** movimiento anterior a esa semana (mismo patrón de balance encadenado que la
    v1), no solo `nSemanas` — necesita el historial completo para no arrastrar un saldo
    inicial incorrecto.
- **Validado contra datos reales** (CDLAO, 4 semanas): Consumo Total ~28% de Venta Neta
  AyB en semanas completas, valores negativos coherentes en la semana en curso (parcial,
  con Compra ya registrada pero sin Venta/Consumo todavía).

**Frontend**: nav `seguimiento-compras` (relabeleado "Eficiencia Consumo/Compra") →
`viewSeguimientoCompras` — selector Operación + "Hasta la semana" (default semana ISO
actual) + "N° de semanas" (default 8, botón "+8 semanas"). Una sola tabla, **filas =
semanas** (no columnas, a diferencia de Flujo de Caja), columnas fijas: Venta Bruta,
Venta Neta, Venta Neta AyB, Saldo Inicial, Ingresos al Almacén (Importe+%, con header
clickeable `▸/▾` que expande 2 columnas extra Compra/Transferencia solo-importe), FC
Teórico (Importe+%), Otros Movimientos (Importe, header clickeable que expande una
columna por cada tipo presente en el rango — unión dinámica, no fija, para que las
columnas sean consistentes en todas las filas mostradas), Inventario Final, Consumo
Total (Importe+%). Formato: importes sin decimales alineados a la derecha (`fmtN`
redondea con `Math.round`), % a 1 decimal centrado, negativos en rojo.

**Nombre del menú**: relabeleado de nuevo a "Seguimiento de Compras" (el nombre
"Eficiencia Consumo/Compra" duró poco). **FC Teórico ya no invierte el signo de
VENTA** — se muestra tal cual viene en la fuente (negativo), a pedido explícito del
usuario: no se cambia el signo de ningún movimiento en este módulo.

**Grupo Compra Especial** (tabla nueva agregada por el usuario al Excel): **no es una
hoja propia** — es una tabla de Excel (ListObject `GRUPO_COMPRA_ESPECIAL`) dentro de la
hoja `TABLAS` ya existente, que también tiene otras 2 tablas (`TABLA_MOVIMIENTOS` en
B4:E49, `OPERACIONES` en G4:I32) en distintas columnas de la misma hoja — por eso
`importSeguimientoCompras.js` la ubica dinámicamente buscando la celda "GRUPO COMPRA"
seguida a la derecha por "OPERACION"/"OPERACIÓN" (comparación sin tildes vía
`sinTilde()`), en vez de asumir un rango de columnas fijo. Columnas: `GRUPO COMPRA`,
`OPERACIÓN` (con tilde). Modelo `GrupoCompraEspecial` (`{operacion, grupoCompra}`,
único por par — el Excel real trae 24 filas con 4 duplicados exactos, el import los
descarta quedando 20). Uso: en la consulta de Eficiencia hay un checkbox "Incluir Grupo
Compra Especial" (**marcado por defecto** — comportamiento igual al anterior) que,
desmarcado, excluye del cálculo todo movimiento cuyo `(operacion, grupoCompra)` matchee
esa tabla — aplicado tanto al Saldo Inicial base (histórico) como a las semanas
mostradas, para que el saldo corrido no quede inconsistente. Botón "👁 Ver Grupo Compra
Especial" junto al checkbox muestra qué grupos de compra aplican para la operación
seleccionada (`GET /seguimiento-compras/grupos-especiales?operacion=`). Validado con
datos reales: GBCFR tiene 78 de 571 movimientos (CAFE TOSTADO/CAFÉ VERDE) que se
excluirían si se desmarca el checkbox.

**Códigos de movimiento cortos** (fix crítico, el Excel origen cambió su vocabulario):
la columna MOVIMIENTO de la hoja MOVIMIENTOS ya no trae nombres largos (BAJA, CONSUMOS,
FALTANTE, SOBRANTE, TRANSFERENCIA, PRODUCCION, TRANSFORMACION, CONSUMO TRANSFORMACION)
sino códigos cortos: `COMPRA, TRANSF, VENTA, INICIAL, CONSUM, CONS PRD, INGR PRD, BAJA,
MERMA, SOBRA, FALTA` (confirmado leyendo el Excel real y contra Mongo tras el
re-import). El cálculo buscaba `'TRANSFERENCIA'` (ya no existe) — se corrigió a
`'TRANSF'`. "Otros Movimientos" se muestra en orden fijo (`OTROS_ORDEN` en el
frontend): `INGR PRD, CONS PRD, CONSUM, BAJA, MERMA, SOBRA, FALTA` — cualquier tipo
nuevo no contemplado cae al final, ordenado alfabéticamente. La tabla `TABLA_MOVIMIENTOS`
de la hoja TABLAS (TRANSACCION→NOMBRE→SIGNO→MOVIMIENTO, 45 filas) **no sirve para
este mapeo** — su propia columna MOVIMIENTO usa una nomenclatura distinta a la de la
hoja MOVIMIENTOS (mismo nombre de columna, vocabularios distintos) — no hay ninguna
tabla ni fórmula en el Excel que documente la relación; la fuente de verdad es
simplemente lo que trae la columna MOVIMIENTO de la hoja MOVIMIENTOS directamente.
Todos los importes/% se muestran en negro (se quitó el rojo para negativos, a pedido
del usuario) y los % siempre en positivo (`Math.abs`, conservando el signo real solo
internamente).

**Tabla de Eficiencia con scroll**: el contenedor de la tabla usa `max-height:340px`
(~8 filas) con `overflow:auto`; con más semanas mostradas aparece scroll vertical en
vez de estirar la página.

**OC por Grupo de Compra** (segunda consulta, debajo de Eficiencia): se restauró el
modelo `SeguimientoCompraOC` (borrado en la Sesión 10, revivido aquí) y el import de
la hoja OC en `importSeguimientoCompras.js` — a diferencia de la v1 (Sesión 8), ya NO
hay flujo de aprobación/Pedido Tienda, es solo una consulta de solo lectura. `GET
/seguimiento-compras/oc?operacion=&semanaObjetivo=` — **fijo a las últimas 3 semanas**
(no configurable), filas = `grupoCompra` (ordenado alfabéticamente), columnas = una
tripleta (Normal/Adicional/Otra, importeOC) por cada una de las 3 semanas. Comparte el
selector de Operación y "Hasta la semana" de la consulta de Eficiencia (se recarga
junto con ella en `cargar()`).

### Sesión 11 — Pronóstico de Venta: canal manual + Venta Neta Propuesta

**IGV%/RC% por operación**: `Operacion` (`models/Operacion.js`) gana `igvPct`/`rcPct`
(fracción, ej. 0.18), editables inline en Admin → Sociedades y Operaciones (tabla de
operaciones de cada sociedad, 2 columnas nuevas) vía `PUT /sociedades/operaciones/:id`.
Se leen en el cliente desde `S.sociedades` (ya cargado app-wide por `loadSociedades()`,
sin fetch propio) — `operacionSeleccionada()`/`pctIgvRc()` en `viewPronosticoVenta`.

**Venta Neta Propuesta** = `Venta Bruta Propuesta / (1 + igvPct + rcPct)` — fórmula
confirmada explícitamente por el usuario (no es "restar % en cascada", es dividir por
el divisor combinado). Se agrega como columna nueva en "RESUMEN DE LA SEMANA", tanto
por canal como en la fila TOTAL.

**Canal manual COMERCIAL** (sin histórico — a diferencia de los demás canales, que
salen de `VentaCanalDiaria.distinct('canal', ...)` y tienen tablas de regresión por
día): botón "➕ Agregar canal Comercial" en el Resumen agrega una fila donde **solo se
edita el importe de Venta Bruta Propuesta directamente** (sin pax/transacciones ni
ticket — a pedido explícito del usuario). Estado cliente separado (`canalesManuales`,
no mezclado con `proyeccion` que es solo para canales con histórico). Persistencia:
`VentaForecast.canales[]` gana `esManual`/`montoManual` (`models/VentaForecast.js`);
al guardar se concatena a los canales normales con `esManual:true, dias:[]`; al cargar
un forecast existente, `cargar()` separa los `esManual` hacia `canalesManuales` en vez
de `proyeccion`. Solo puede haber un canal "COMERCIAL" a la vez (botón se oculta si ya
existe); se puede quitar con el botón 🗑️ de su fila (mientras no esté bloqueado).

### Sesión 12 — Seguimiento de Compras: sección Ítems SD

Hasta esta sesión `importSeguimientoCompras.js` descartaba toda fila con
`GRUPO !== 'FC'` (comentario "solo se importa FC" en ambos modelos). A
pedido del usuario se agregó una sección nueva en el módulo, en espejo de
la existente, para los ítems con `GRUPO = 'SD'` — que ahora se importan
también (ambos grupos quedan en las mismas colecciones, distinguidos por
el campo `grupo` que ya existía en los modelos).

**Backend** (`routes/seguimiento-compras.js`): `/eficiencia` y `/oc` aceptan
`grupo=FC|SD` (default `FC`) y filtran los movimientos/OC por ese campo.
`calcularSemanaEficiencia(docs, esSD)` cambia de fórmula para SD, a pedido
explícito del usuario: **no separa Transferencia ni FC Teórico** — solo se
aparta la Compra; todo lo demás (incluida VENTA y TRANSF) va junto a
**Otros Movimientos**. El cuadro "OC por Grupo de Compra" es idéntico al de
FC, solo cambia el filtro `grupo`.

**Frontend** (`public/app.js`, `viewSeguimientoCompras`): sección nueva
"🗂️ Ítems SD" debajo de la existente, con su propia tabla de Eficiencia
(`renderTablaSD`, columnas Compra + Otros Movimientos, sin FC Teórico) y su
propio "OC por Grupo de Compra" (`renderTablaOC` generalizada para aceptar
el elemento raíz como parámetro y reusarse en ambas secciones) — comparten
el selector de Operación/Semana/N° semanas de la sección FC.

**Pendiente de ejecutar en el servidor (CORPSERV-PRUEBA)**: `sync-master.bat`
(y su paso `sync-seguimiento-compras.bat`) corre con la copia local del
repo en `C:\pedidos-app\`, que **no se actualiza sola** — ningún bat hace
`git pull` (solo `sync-excel.bat` hace `git push`, en sentido contrario).
Mientras no se corra `git pull origin main` en el servidor, el import
seguirá usando el script viejo (descarta SD) aunque el código ya esté en
GitHub. Confirmado por consulta directa a Mongo: 0 documentos con
`grupo:'SD'` en `SeguimientoCompraMovimiento`/`SeguimientoCompraOC` pese a
que el Excel de origen sí trae filas SD. Acción pendiente: en el servidor,
`cd C:\pedidos-app && git pull origin main && sync-seguimiento-compras.bat`
(o esperar a que alguien lo haga antes de la corrida de las 6 AM — el
`git pull` no está automatizado, así que si no se hace a mano seguirá
desactualizado indefinidamente).

### Sesión 13 — Automatización de Gestión de Pagos (EBC) + borrado de Pagos Recurrentes

**Automatización de 3 de los 4 botones de carga de Paso 1 — Programación** (antes
100% manual desde el navegador, carpeta origen `C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\
EBC AI BASES\EBC PROGRAMACION DE PAGOS\`). El botón **PROGRAMACIÓN** (archivo por
sociedad) ya no es 100% manual — se automatizó también, con guardas (ver abajo); el
resto de la UI (Paso 2 a 5, aprobación/preparación/autorización/pago) sigue siendo
manual como antes.

- **PAGOS** (`EBC PAGOS.csv`) → `scripts/syncPagosPromedios.js` (`sync-pagos-promedios.bat`,
  paso 18/20 de `sync-master.bat`) — replica `POST /api/pagos/cargar-pagos`: calcula
  promedio de pago de las 4 semanas más recientes por beneficiario y actualiza
  `PagoProgramacion.promediosPagos` **solo** de programaciones ya abiertas
  (`borrador`/`pendiente`); si una sociedad no tiene programación abierta, se omite
  (no crea nada).
- **POR RENDIR** (`EBC ADELANTOS.csv`) → `scripts/syncAdelantos.js` (`sync-adelantos.bat`,
  paso 19/20) — replica `POST /api/pagos/adelantos/cargar`: `deleteMany`+`insertMany`
  completo en `PagoAdelanto`, por las sociedades presentes en el archivo (columna
  `CompaniaSocio`, mapeada a nombre de sociedad vía `CompaniaCodigo`, mismo catálogo
  que usa Obligaciones EBC).
- **OBLIGACIONES EBC** (`EBC OBLIGACIONES.csv`) ya estaba automatizado desde antes
  (`sync-obligaciones.bat`, paso 10/20) — sin cambios.
- **PROGRAMACIÓN** (archivo por sociedad: `ERSAC.csv`, `FRQ1.csv`, `MUVON.csv`,
  `GOLDEN_BEAN.csv`, `QUIASMO.csv`, `FK.csv`) → `scripts/syncProgramacion.js`
  (`sync-programacion.bat`, paso 20/20) — replica `POST /api/pagos/cargar` (mismo
  cruce con `PagoBeneficiario`, mismo cálculo de `diasVencido`/`seleccionado`). Dos
  guardas explícitas a pedido del usuario: (1) **solo corre los martes** (`new
  Date().getDay() !== 2` corta el script entero antes de tocar cualquier archivo);
  (2) **por sociedad**, si ya existe una `PagoProgramacion` para esa sociedad+semana
  actual (`año`+`semana` del próximo viernes), no genera nada para esa sociedad (pero
  sigue con las demás) — evita duplicar lo que hoy pasaría si se subiera el mismo
  archivo dos veces a mano. `creadoPor` queda como `"AUTOMATICO (sync-programacion)"`.
  Mapeo archivo→sociedad (`ARCHIVO_POR_COMPANIA` en el script) confirmado contra
  datos reales: `GOLDEN_BEAN.csv`→`GB`, `FK.csv`→`FACTORIAL K`.
- Los 3 archivos por sociedad para el módulo QUIASMO/FACTORIAL K ya existían como
  sociedad en el sistema (dados de alta antes de esta sesión, no en esta) — la base
  local de un proyecto hermano (`payment_app`, Flask, descartado como referencia)
  estaba desactualizada y no las tenía, lo que generó confusión inicial sobre si
  había que crearlas.
- **Validado en producción**: `sync-adelantos.bat` cargó 103 adelantos (6 sociedades);
  `sync-pagos-promedios.bat` actualizó promedios de ERSAC y MUVON (únicas con
  programación abierta ese día, el resto se omitió correctamente);
  `sync-programacion.bat` corrió en martes real y creó programación nueva para las 6
  sociedades (confirmado con el usuario, ej. FACTORIAL K: 433 obligaciones).
- Todos los scripts nuevos siguen el patrón exacto de `scripts/syncObligaciones.js`
  (`dns.setServers(['8.8.8.8','8.8.4.4'])` antes de conectar — mismo workaround de DNS
  que ya usan los scripts existentes en este entorno).

**Borrado completo de Pagos Recurrentes** (código y datos, a pedido del usuario — ver
nota en Sesión 7): se quitaron `routes/pagos-recurrentes.js`, los 3 modelos
(`PagoRecurrenteTipo`/`Regla`/`Programacion`), el mount en `server.js`, el nav item y
la función `viewPagosRecurrentes` completa en `public/app.js`, el campo
`rolPagoRecurrente` en `models/User.js` y sus referencias en `routes/users.js` /
`routes/auth.js` / el form de usuarios. Datos borrados de MongoDB (drop de las 3
colecciones, vía script temporal no commiteado): 1 `PagoRecurrenteTipo`, 3
`PagoRecurrenteRegla`, 21 `PagoRecurrenteProgramacion`.
