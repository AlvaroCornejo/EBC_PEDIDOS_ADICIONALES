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
