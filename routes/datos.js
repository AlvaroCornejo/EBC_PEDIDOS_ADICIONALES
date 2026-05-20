/**
 * datos.js — lee desde archivo único por operación: {OPERACION} - ADICIONALES.xlsx
 *
 * Hoja "Items":        col1=ITEM, col2=NOMBRE, col3=GRUPO COMPRA  (común a todas las operaciones)
 * Hoja "Kardex":       col1=ITEM, col2=TRX (VTA/TRE/OTR), col3=AÑOSEM (YYYYWW), col4=CANTIDAD
 * Hoja "Costos":       col1=ITEM, col2=COSTO  (ya es el último costo)
 * Hoja "Requisiciones":col1=Item, col2=CONSUMO PROY SEM ANT, col3=CONSUMO PROY SEM ACT
 */

const express = require('express');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const Item = require('../models/Item');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../data');

router.use(authMiddleware);

// ─── Helpers ──────────────────────────────────────────────────────

function cellVal(row, col) {
  const v = row.getCell(col).value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result  !== undefined) return v.result;
    if (v.richText !== undefined) return v.richText.map(r => r.text).join('');
    return null;
  }
  return v;
}

const num = (row, col) => parseFloat(cellVal(row, col)) || 0;
const str = (row, col) => { const v = cellVal(row, col); return v != null ? String(v).trim() : ''; };

function toAñoSem(year, week) { return year * 100 + week; }

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
  return { week, year: d.getUTCFullYear() };
}

/** Encuentra el archivo ADICIONALES para una operación */
function findFile(operacion) {
  const names = [
    `${operacion} - ADICIONALES.xlsx`,
    `${operacion} - Adicionales.xlsx`,
    `${operacion}.xlsx`
  ];
  for (const n of names) {
    const fp = path.join(DATA_DIR, n);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

/** Carga y cachea el workbook (por sesión de request, no persistente) */
async function loadWB(fp) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  return wb;
}

// ─── Readers ──────────────────────────────────────────────────────

/** Items sheet: col1=ITEM, col2=NOMBRE, col3=GRUPO COMPRA, col4=GESTION */
function readItems(wb) {
  const sh = wb.getWorksheet('Items');
  if (!sh) return [];
  const items = [];
  sh.eachRow((row, rn) => {
    if (rn === 1) return;
    const item = str(row, 1);
    const nombre = str(row, 2);
    const grupoCompra = str(row, 3);
    const gestion = str(row, 4) || 'COMPRAS';
    if (item) items.push({ item, nombre, grupoCompra, gestion });
  });
  return items;
}

/** Kardex sheet: col1=ITEM, col2=TRX, col3=AÑOSEM, col4=CANTIDAD */
function readKardex(wb) {
  const sh = wb.getWorksheet('Kardex');
  if (!sh) return [];
  const rows = [];
  sh.eachRow((row, rn) => {
    if (rn === 1) return;
    const item   = str(row, 1);
    const trx    = str(row, 2).toUpperCase();
    const añosem = num(row, 3);
    const cant   = num(row, 4);
    if (item && añosem) rows.push({ item, trx, añosem, cant });
  });
  return rows;
}

/** Costos sheet: col1=ITEM, col2=COSTO */
function readCostos(wb) {
  const sh = wb.getWorksheet('Costos');
  if (!sh) return {};
  const map = {};
  sh.eachRow((row, rn) => {
    if (rn === 1) return;
    const item = str(row, 1);
    if (item) map[item] = num(row, 2);
  });
  return map;
}

/** Requisiciones sheet: col1=Item, col2=CONSUMO PROY SEM ANT, col3=CONSUMO PROY SEM ACT */
function readRequisiciones(wb) {
  const sh = wb.getWorksheet('Requisiciones');
  if (!sh) return {};
  const map = {};
  sh.eachRow((row, rn) => {
    if (rn === 1) return;
    const item = str(row, 1);
    if (item) map[item] = { semAnt: num(row, 2), semAct: num(row, 3) };
  });
  return map;
}

// ─── Routes ──────────────────────────────────────────────────────

/** GET /api/datos/items?operacion=AASI */
router.get('/items', async (req, res) => {
  try {
    const { operacion } = req.query;
    // Si se pide por operación específica usa ese archivo; si no, busca cualquiera disponible
    let fp = operacion ? findFile(operacion) : null;
    if (!fp) {
      // Buscar cualquier archivo ADICIONALES disponible
      const any = fs.readdirSync(DATA_DIR).find(f => f.includes('ADICIONALES') && f.endsWith('.xlsx'));
      if (any) fp = path.join(DATA_DIR, any);
    }
    if (!fp) return res.json([]);
    const wb = await loadWB(fp);
    res.json(readItems(wb));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/datos/item-data?item=ID&operacion=AASI&fecha=2026-05-16 */
router.get('/item-data', async (req, res) => {
  try {
    const { item, operacion, fecha } = req.query;
    if (!item || !operacion || !fecha) {
      return res.status(400).json({ error: 'item, operacion y fecha son requeridos' });
    }

    const fp = findFile(operacion);
    if (!fp) return res.status(404).json({ error: `No se encontró archivo para operación ${operacion}` });

    const wb = await loadWB(fp);
    const itemsMap    = Object.fromEntries(readItems(wb).map(i => [i.item, i]));
    const costosMap   = readCostos(wb);
    const kardexRows  = readKardex(wb);
    const reqMap      = readRequisiciones(wb);

    const date = new Date(fecha + 'T12:00:00');
    const { week: cw, year: cy } = getISOWeek(date);
    const añoSemAct = toAñoSem(cy, cw);
    // Semana anterior en el kardex = semana previa
    const añoSemAnt = cw > 1 ? toAñoSem(cy, cw - 1) : toAñoSem(cy - 1, 52);

    const itemKey = String(item).trim();

    // Maestro (Excel + MongoDB para loteCompra/gestion actualizado)
    const maestro     = itemsMap[itemKey] || {};
    const dbItem      = await Item.findOne({ operacion, item: itemKey }).lean();
    const grupoCompra = maestro.grupoCompra || '';
    const gestion     = dbItem?.gestion ?? maestro.gestion ?? 'COMPRAS';
    const loteCompra  = dbItem?.loteCompra ?? 0;
    const costoUnitario = costosMap[itemKey] || 0;

    // Consumos estimados de Requisiciones
    const rq = reqMap[itemKey] || { semAnt: 0, semAct: 0 };

    // Consumos reales del Kardex por semana
    function kardexSem(añosem) {
      let vta = 0, tre = 0, pro = 0;
      kardexRows
        .filter(r => r.item === itemKey && r.añosem === añosem)
        .forEach(r => {
          if      (r.trx === 'VENTA')                  vta += r.cant;
          else if (r.trx === 'CONSUMO TRANSFORMACION') tre += r.cant;
          else if (r.trx === 'CONSUMO PRODUCCION')     pro += r.cant;
        });
      return { vta: Math.abs(vta), consumo: Math.abs(tre) + Math.abs(pro) };
    }

    const kAct = kardexSem(añoSemAct);
    const kAnt = kardexSem(añoSemAnt);

    // Saldo: suma de todas las cantidades del item en el kardex
    const saldo = kardexRows
      .filter(r => r.item === itemKey)
      .reduce((s, r) => s + r.cant, 0);

    res.json({
      grupoCompra,
      gestion,
      loteCompra,
      costoUnitario,
      semanaAnterior: {
        label: `Sem ${añoSemAnt % 100}/${Math.floor(añoSemAnt / 100)}`,
        consumoEstimado:  rq.semAnt,
        consumoRealVenta: kAnt.vta,
        consumoReal:      kAnt.consumo,
        variacion: (kAnt.vta + kAnt.consumo) - rq.semAnt
      },
      semanaActual: {
        label: `Sem ${cw}/${cy}`,
        consumoEstimado:  rq.semAct,
        consumoRealVenta: kAct.vta,
        consumoReal:      kAct.consumo,
        variacion: (kAct.vta + kAct.consumo) - rq.semAct
      },
      saldo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/datos/kardex-item?item=ID&operacion=AASI */
router.get('/kardex-item', async (req, res) => {
  try {
    const { item, operacion } = req.query;
    if (!item || !operacion) return res.status(400).json({ error: 'item y operacion requeridos' });

    const fp = findFile(operacion);
    if (!fp) return res.status(404).json({ error: `No se encontró archivo para ${operacion}` });

    const wb    = await loadWB(fp);
    const rows  = readKardex(wb).filter(r => r.item === String(item).trim());

    if (!rows.length) return res.json([]);

    // Semanas únicas ordenadas
    const semanas = [...new Set(rows.map(r => r.añosem))].sort((a, b) => a - b);

    // Agrupar cantidades por semana y TRX
    const byWeek = {};
    for (const r of rows) {
      if (!byWeek[r.añosem]) byWeek[r.añosem] = {};
      byWeek[r.añosem][r.trx] = (byWeek[r.añosem][r.trx] || 0) + r.cant;
    }

    // Calcular saldo acumulado
    let saldoAcum = 0;
    const result = semanas.map(s => {
      const saldoInicial = saldoAcum;
      const movs = byWeek[s] || {};
      const totalSem = Object.values(movs).reduce((a, b) => a + b, 0);
      const saldoFinal = saldoInicial + totalSem;
      saldoAcum = saldoFinal;
      return { semana: s, saldoInicial, movimientos: movs, saldoFinal };
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/datos/files */
router.get('/files', (req, res) => {
  if (!fs.existsSync(DATA_DIR)) return res.json([]);
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.xlsx') || f.endsWith('.xlsm'))
    .map(f => {
      const st = fs.statSync(path.join(DATA_DIR, f));
      return { name: f, size: st.size, modified: st.mtime };
    });
  res.json(files);
});

module.exports = router;
// Exportar helpers para que items.js pueda reutilizarlos
module.exports.readItems = readItems;
module.exports.findFile  = findFile;
module.exports.loadWB    = loadWB;
