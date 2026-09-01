require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const fs       = require('fs');
const mongoose = require('mongoose');
const CompaniaCodigo    = require('../models/CompaniaCodigo');
const PagoProgramacion  = require('../models/PagoProgramacion');

const CSV_PATH = process.env.EBC_PAGOS_PATH ||
  'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC PROGRAMACION DE PAGOS\\EBC PAGOS.csv';

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

// CSV con cabecera en la primera fila - mismo parser que parseCSV en routes/pagos.js
function parseCSV(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
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

(async () => {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Archivo no encontrado: ${CSV_PATH}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const mapaDocs = await CompaniaCodigo.find().lean();
  const mapaCompanias = {};
  mapaDocs.forEach(d => { mapaCompanias[d.codigo] = d.compania; });

  const rows = parseCSV(fs.readFileSync(CSV_PATH));

  // Misma logica que POST /api/pagos/cargar-pagos: promedio de pago de las
  // 4 semanas mas recientes por beneficiario, solo se aplica a programaciones
  // ya abiertas (borrador/pendiente) - si no hay ninguna abierta para una
  // compania, esa compania se omite (no crea nada nuevo).
  const parsedRows = [];
  for (const r of rows) {
    const pagarA = (r['PagarA'] || '').trim();
    if (!pagarA) continue;
    const fRaw  = (r['FechaPago'] || '').split(':')[0].trim();
    const fecha = parseFecha(fRaw);
    if (!fecha || isNaN(fecha)) continue;
    const monto = parseFloat(r['PagoMonedaLocal'] || r['PagoMonedaExtranjera'] || 0) || 0;
    const clave = `${fecha.getFullYear()}-${String(isoWeek(fecha)).padStart(2, '0')}`;
    const companiaCodigo = (r['CompaniaCodigo'] || '').trim();
    const compania = mapaCompanias[companiaCodigo] || companiaCodigo;
    parsedRows.push({ pagarA, monto, clave, compania });
  }

  if (!parsedRows.length) {
    console.log('Sin filas validas en el archivo');
    await mongoose.disconnect();
    return;
  }

  const todasSemanas = [...new Set(parsedRows.map(r => r.clave))].sort().reverse();
  const semanas4 = new Set(todasSemanas.slice(0, 4));

  const porCompania = {};
  for (const r of parsedRows) {
    if (!semanas4.has(r.clave)) continue;
    if (!porCompania[r.compania]) porCompania[r.compania] = {};
    const benef = porCompania[r.compania];
    if (!benef[r.pagarA]) benef[r.pagarA] = { total: 0, semanas: new Set() };
    benef[r.pagarA].total += r.monto;
    benef[r.pagarA].semanas.add(r.clave);
  }

  const actualizadas = [];
  const sinProgramacionAbierta = [];
  for (const [compania, benef] of Object.entries(porCompania)) {
    const resultado = {};
    for (const [pa, d] of Object.entries(benef)) {
      resultado[pa.toUpperCase()] = {
        total:    d.total,
        semanas:  d.semanas.size,
        promedio: d.semanas.size > 0 ? d.total / d.semanas.size : 0,
      };
    }
    const prog = await PagoProgramacion.findOne(
      { compania, estado: { $in: ['borrador', 'pendiente'] } }
    ).sort({ creadoEn: -1 });
    if (prog) {
      await PagoProgramacion.findByIdAndUpdate(prog._id, { promediosPagos: resultado });
      actualizadas.push(compania);
    } else {
      sinProgramacionAbierta.push(compania);
    }
  }

  console.log(`Companias con programacion actualizada: ${actualizadas.join(', ') || '(ninguna)'}`);
  if (sinProgramacionAbierta.length) {
    console.log(`Sin programacion abierta (omitidas): ${sinProgramacionAbierta.join(', ')}`);
  }
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
