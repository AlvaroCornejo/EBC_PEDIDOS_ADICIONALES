require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const fs       = require('fs');
const mongoose = require('mongoose');
const CompaniaCodigo = require('../models/CompaniaCodigo');
const ObligacionEBC  = require('../models/ObligacionEBC');

const CSV_PATH = process.env.EBC_OBLIGACIONES_PATH ||
  'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC PROGRAMACION DE PAGOS\\EBC OBLIGACIONES.csv';

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

function parseFecha(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`) : null;
}

function parseCSV(buffer, mapaCompanias) {
  const lines   = buffer.toString('latin1').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const idx     = name => headers.indexOf(name);

  const iCompCod  = idx('CompaniaCodigo');
  const iBusqueda = idx('Busqueda');
  const iNumDoc   = idx('NumeroDocumento');
  const iTipoDoc  = idx('TipoDocumento');
  const iFechaV   = idx('FechaVencimiento');
  const iFechaD   = idx('FechaDocumento');
  const iMoneda   = idx('MonedaDocumento');
  const iMonto    = idx('MontoObligacion');
  const iEstado   = idx('EstadoDocumento');
  const iNombre   = idx('NombreCompleto');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v   = parseCSVLine(lines[i]);
    const get = j => (v[j] !== undefined ? v[j] : '').trim();
    const estadoDoc = get(iEstado);
    if (estadoDoc !== 'AP' && estadoDoc !== 'PP') continue;
    const proveedor = get(iBusqueda);
    if (!proveedor) continue;
    const companiaCodigo = get(iCompCod);
    rows.push({
      compania:         mapaCompanias[companiaCodigo] || companiaCodigo,
      companiaCodigo,
      proveedor,
      proveedorKey:     proveedor.toUpperCase(),
      numeroDocumento:  get(iNumDoc),
      tipoDocumento:    get(iTipoDoc),
      fechaVencimiento: parseFecha(get(iFechaV)),
      fechaDocumento:   parseFecha(get(iFechaD)),
      moneda:           get(iMoneda),
      monto:            parseFloat(get(iMonto)) || 0,
      estadoDoc,
      responsable:      get(iNombre),
    });
  }
  return rows;
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

  const rows = parseCSV(fs.readFileSync(CSV_PATH), mapaCompanias);
  if (!rows.length) {
    console.log('Sin filas AP/PP en el archivo');
    await mongoose.disconnect();
    return;
  }

  const companias = [...new Set(rows.map(r => r.compania))];
  await ObligacionEBC.deleteMany({ compania: { $in: companias } });
  await ObligacionEBC.insertMany(rows);

  console.log(`${rows.length} obligaciones cargadas (${companias.join(', ')})`);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
