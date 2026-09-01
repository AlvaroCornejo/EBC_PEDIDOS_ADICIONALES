require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');
const PagoBeneficiario = require('../models/PagoBeneficiario');
const PagoProgramacion = require('../models/PagoProgramacion');

const BOX_DIR = process.env.EBC_PROGRAMACION_DIR ||
  'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC PROGRAMACION DE PAGOS';

// Nombre de archivo (sin ruta) -> codigo de compania (Sociedad.codigo / PagoProgramacion.compania).
// TODO confirmar con el usuario: GOLDEN_BEAN.csv -> GB y FK.csv -> FACTORIAL K son la lectura
// mas directa de la captura de pantalla, pero no estan verificados contra el archivo real.
const ARCHIVO_POR_COMPANIA = {
  'ERSAC.csv':       'ERSAC',
  'FRQ1.csv':        'FRQ1',
  'MUVON.csv':       'MUVON',
  'GOLDEN_BEAN.csv': 'GB',
  'QUIASMO.csv':     'QUIASMO',
  'FK.csv':          'FACTORIAL K',
};

const BANCO_MAP = { AB: 'BBVA', IB: 'IBK', EX: 'BCP' };
const CREADO_POR = 'AUTOMATICO (sync-programacion)';

function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseFecha(str) {
  if (!str) return null;
  const [datePart] = str.trim().split(' ');
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}

// Proximo viernes estricto (si hoy es viernes -> el siguiente) - mismo criterio que
// proxViernes() en routes/pagos.js.
function proxViernes(desde = new Date()) {
  const d = new Date(desde);
  d.setUTCHours(12, 0, 0, 0);
  const diasHasta = ((5 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + diasHasta);
  return d;
}

// Parsear Q PROGRAMACION.csv - mismo layout/fallbacks que parseCSVProgramacion en routes/pagos.js.
function parseCSVProgramacion(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  const col = (name, fallback) => {
    const i = headers.indexOf(name);
    return i !== -1 ? i : fallback;
  };
  const fdAll = headers.reduce((acc, h, i) => h === 'FechaDocumento' ? [...acc, i] : acc, []);

  const COL = {
    tipo : col('TipoDocumento',  0),
    num  : col('NumeroDocumento',1),
    banco: col('Banco',          4),
    fv   : col('FechaVencimiento',5),
    mon  : col('MonedaDocumento', 7),
    mto  : col('MontoMoneda',     8),
    pa   : col('PagarA',          9),
    fd   : fdAll.length ? fdAll[fdAll.length - 1] : 32,
  };

  return lines.slice(1).map(line => {
    const v = parseCSVLine(line);
    const get = i => (v[i] || '').trim();
    const bancoCode = get(COL.banco);
    return {
      TipoDocumento:    get(COL.tipo),
      NumeroDocumento:  get(COL.num),
      Banco:            BANCO_MAP[bancoCode] || bancoCode,
      FechaVencimiento: get(COL.fv),
      MonedaDocumento:  get(COL.mon),
      MontoMoneda:      get(COL.mto),
      PagarA:           get(COL.pa),
      FechaDocumento:   get(COL.fd),
    };
  }).filter(r => r.TipoDocumento && r.PagarA);
}

async function procesarCompania(compania, archivo) {
  const csvPath = path.join(BOX_DIR, archivo);
  if (!fs.existsSync(csvPath)) {
    console.log(`  [${compania}] archivo no encontrado: ${csvPath} - omitido`);
    return;
  }

  const fechaPago = proxViernes();
  const semana    = isoWeek(fechaPago);
  const año       = fechaPago.getFullYear();

  // Si ya existe una programacion para esta compania+semana, no generar nada (evita duplicados).
  const existente = await PagoProgramacion.findOne({ compania, año, semana });
  if (existente) {
    console.log(`  [${compania}] ya existe programacion para semana ${año}-${semana} (id ${existente._id}) - no se genera nada`);
    return;
  }

  const rows = parseCSVProgramacion(fs.readFileSync(csvPath));
  if (!rows.length) {
    console.log(`  [${compania}] archivo vacio o invalido - omitido`);
    return;
  }

  const benefMap = {};
  const bens = await PagoBeneficiario.find({ compania }).lean();
  bens.forEach(b => { benefMap[b.nombre.trim().toUpperCase()] = b; });

  const obligaciones = [];
  const nuevosBenef  = {};

  for (const r of rows) {
    const pagarA = (r['PagarA'] || '').trim();
    if (!pagarA) continue;

    const fv = parseFecha(r['FechaVencimiento']);
    const fd = parseFecha(r['FechaDocumento']);
    const diasVencido = fv ? Math.round((fechaPago - fv) / 86400000) : 0;

    const key          = pagarA.toUpperCase();
    const grupo        = benefMap[key]?.grupo        || 'OTROS';
    const detalleGrupo = benefMap[key]?.detalleGrupo || 'OTROS';
    const banco        = benefMap[key]?.banco || (r['Banco'] || '').trim();

    if (!nuevosBenef[key]) {
      nuevosBenef[key] = { nombre: pagarA, compania, grupo, banco };
    }

    obligaciones.push({
      tipoDocumento:    (r['TipoDocumento'] || '').trim(),
      numeroDocumento:  (r['NumeroDocumento'] || '').trim(),
      fechaVencimiento: fv,
      moneda:           (r['MonedaDocumento'] || '').trim(),
      monto:            parseFloat(r['MontoMoneda']) || 0,
      pagarA,
      fechaDocumento:   fd,
      banco:            (r['Banco'] || '').trim(),
      diasVencido,
      grupo,
      detalleGrupo,
      seleccionado:     diasVencido >= 0 && diasVencido <= 9,
      bancoAsignado:    (r['MonedaDocumento']||'').trim() === 'LO'
                          ? (benefMap[key]?.bancoDefaultSOL || '')
                          : (benefMap[key]?.bancoDefaultUSD || ''),
      agrupadorPago:    (r['MonedaDocumento']||'').trim() === 'LO'
                          ? (benefMap[key]?.agrupadorDefaultSOL || 'INDIVIDUAL')
                          : (benefMap[key]?.agrupadorDefaultUSD || 'INDIVIDUAL'),
    });
  }

  for (const b of Object.values(nuevosBenef)) {
    await PagoBeneficiario.findOneAndUpdate(
      { nombre: b.nombre, compania: b.compania },
      { $set: { banco: b.banco, updatedAt: new Date() },
        $setOnInsert: { grupo: b.grupo } },
      { upsert: true, new: true }
    );
  }

  const prog = await PagoProgramacion.create({
    compania, fechaPago, semana, año,
    creadoPor: CREADO_POR,
    obligaciones,
  });

  console.log(`  [${compania}] programacion creada (id ${prog._id}, ${obligaciones.length} obligaciones, semana ${año}-${semana})`);
}

(async () => {
  const hoy = new Date();
  if (hoy.getDay() !== 2) { // 0=domingo ... 2=martes
    console.log(`Hoy no es martes (${hoy.toLocaleDateString('es-PE')}) - no se genera programacion.`);
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  for (const [archivo, compania] of Object.entries(ARCHIVO_POR_COMPANIA)) {
    await procesarCompania(compania, archivo);
  }

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
