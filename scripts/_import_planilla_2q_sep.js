/**
 * Carga inicial de trabajadores para la Planilla 2Q de septiembre 2026, desde
 * "TRABAJDORES VALIDADOS.xlsx" (208 trabajadores, 6 operaciones). Borra
 * primero cualquier Planilla existente de esa operación+mes+quincena y crea
 * una nueva con los trabajadores del Excel.
 *
 * Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_import_planilla_2q_sep.js
 * Borrar este archivo y su .json después de correrlo una vez.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const Planilla = require('../models/Planilla');
const porOperacion = require('./_import_planilla_2q_sep_data.json');

const MES = 9;
const QUINCENA = '2Q';
const FECHA_PAGO = '2026-09-30';
const FECHA_LIMITE_RRHH = '2026-09-24T23:59:00';
const FECHA_LIMITE_MANAGER = '2026-09-26T23:59:00';
const FECHA_LIMITE_GAF = '2026-09-28T23:59:00';
const FECHA_LIMITE_VOBO = '2026-09-29T23:59:00';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  for (const [operacion, lista] of Object.entries(porOperacion)) {
    const del = await Planilla.deleteMany({ operacion, mes: MES, quincena: QUINCENA });
    if (del.deletedCount) console.log(`${operacion}: se borró 1 planilla previa de 2Q setiembre.`);

    const trabajadores = lista.map(t => ({
      codigo: t.codigo, nombre: t.nombre, fechaIngreso: t.fechaIngreso,
      tipoDocumento: t.tipoDocumento, numeroDocumento: t.numeroDocumento,
      basico: t.basico, sueldoReferencial: t.esperado, asignacionFamiliar: t.asignacionFamiliar,
      cargo: t.cargo, esperado: String(t.esperado),
    }));

    const doc = await Planilla.create({
      operacion, mes: MES, quincena: QUINCENA,
      fechaPago: FECHA_PAGO,
      fechaLimiteRRHH: FECHA_LIMITE_RRHH,
      fechaLimiteManager: FECHA_LIMITE_MANAGER,
      fechaLimiteGAF: FECHA_LIMITE_GAF,
      fechaLimiteVoBo: FECHA_LIMITE_VOBO,
      creadoPor: 'IMPORT (TRABAJADORES VALIDADOS.xlsx)',
      trabajadores,
    });
    console.log(`✓ ${operacion}: ${doc.trabajadores.length} trabajadores cargados.`);
  }

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
