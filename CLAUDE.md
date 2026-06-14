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
['AASI', 'CDLAO', 'CDL28', 'CORP', 'DOSIMETRIA', 'PREP', 'GBADC', 'GBCFR', 'GBCFR2', 'GBCRP', 'GBGOL', 'GBSRQ', 'GBPLANTA']
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

## Fuentes de datos

### Excel (diario via sync-excel.bat)
- Hoja **Items**: col1=ITEM, col2=NOMBRE, col3=GRUPO COMPRA, col4=GESTION
- Hoja **Kardex**: col1=ITEM, col2=TRX, col3=AÑOSEM (YYYYWW), col4=CANTIDAD
- Hoja **Costos**: col1=ITEM, colX=COSTO (detectado dinámicamente desde cabecera)
- Hoja **Requisiciones**: col1=ITEM, col2=SEM ANT, col3=SEM ACT, col4=AJUSTE ACT, col5=AJUSTE ANT
- Ruta Box origen: `C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES\`
- Destino en servidor sync: `C:\pedidos-app\data\`

### MongoDB (colecciones y scripts de importación)

| Colección | Script | Fuente | Frecuencia |
|-----------|--------|--------|------------|
| Item | `scripts/syncItems.js` (vía `sync-items.bat`) | data/*ADICIONALES.xlsx | diario |
| CompraPareto / CompraRoc | `scripts/importCompras.js` | EBC COMPRAS HISTORICAS.xlsx | semanal |
| ComparativoOC | `scripts/importComparativoOC.js` | COMPARATIVO OC INGRESOS.xlsx | diario |
| VentasTip | `scripts/importVentasTip.js` | EBC VENTAS TIP RESUMEN.xlsx | diario |
| KardexBajaVenta | `scripts/importBajas.js` | data/*ADICIONALES.xlsx | diario |

- Sync manual de items desde consola del navegador (admin logueado), si se necesita fuera del horario del bat:
```javascript
(async () => {
  const ops = ['AASI','CDLAO','CDL28','CORP','DOSIMETRIA','PREP','GBADC','GBCFR','GBCFR2','GBCRP','GBGOL','GBSRQ','GBPLANTA'];
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
| 1 | `sync-excel.bat` | Copia 13 ADICIONALES de Box → `data\` + git push |
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
