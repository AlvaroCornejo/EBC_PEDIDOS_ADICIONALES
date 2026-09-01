require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const fs       = require('fs');
const mongoose = require('mongoose');
const CompaniaCodigo = require('../models/CompaniaCodigo');
const PagoAdelanto   = require('../models/PagoAdelanto');

const CSV_PATH = process.env.EBC_ADELANTOS_PATH ||
  'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC PROGRAMACION DE PAGOS\\EBC ADELANTOS.csv';

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
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

// ADELANTOS.csv trae columnas duplicadas (FechaDocumento y Busqueda 2 veces),
// por eso se usan indices fijos - mismo layout que parseCSVAdelantos en routes/pagos.js.
function parseCSV(buffer) {
  const lines = buffer.toString('latin1').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const idxCompania = headers.indexOf('CompaniaSocio');
  if (idxCompania === -1) throw new Error('No se encontro la columna CompaniaSocio en el archivo');

  return lines.slice(1).map(line => {
    const v = parseCSVLine(line);
    const get = i => (v[i] || '').trim();
    return {
      companiaCodigo: get(idxCompania).slice(0, -2),
      numeroAdelanto: get(1),
      fechaDocumento: parseFecha(get(4)),
      montoTotal:     parseFloat(get(6)) || 0,
      saldoAdelanto:  parseFloat(get(7)) || 0,
      estado:         get(8),
      proveedor:      get(9),
      moneda:         get(10),
      tipoAdelanto:   get(11),
      responsable:    get(13),
      centroCostos:   get(14),
    };
  }).filter(r => r.numeroAdelanto && r.proveedor);
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
  if (!rows.length) {
    console.log('Sin filas validas en el archivo');
    await mongoose.disconnect();
    return;
  }

  const docs = rows.map(({ companiaCodigo, ...r }) => ({
    ...r,
    compania: mapaCompanias[companiaCodigo] || companiaCodigo,
    proveedorKey: r.proveedor.trim().toUpperCase(),
  }));

  const companias = [...new Set(docs.map(d => d.compania))];
  await PagoAdelanto.deleteMany({ compania: { $in: companias } });
  await PagoAdelanto.insertMany(docs);

  console.log(`${docs.length} adelantos cargados (${companias.join(', ')})`);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
