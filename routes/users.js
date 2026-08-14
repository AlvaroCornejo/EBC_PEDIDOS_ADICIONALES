const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Operacion = require('../models/Operacion');
const Sociedad  = require('../models/Sociedad');

const router = express.Router();
const adminOnly = (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Solo administradores' });
const strip = (u) => { const o = u.toObject ? u.toObject() : { ...u }; delete o.password; return o; };

// Antes no se validaba que los códigos de operación/sociedad enviados desde el form de
// usuarios existieran realmente — cualquier string se guardaba tal cual. Ahora se filtran
// contra el catálogo real (models/Operacion.js, models/Sociedad.js).
async function codigosValidos() {
  const [ops, socs] = await Promise.all([Operacion.distinct('codigo'), Sociedad.distinct('codigo')]);
  return { ops: new Set(ops), socs: new Set(socs) };
}
const filtrarCodigos = (arr, validSet) => Array.isArray(arr) ? arr.filter(c => validSet.has(c)) : [];

router.use(authMiddleware);

router.get('/', adminOnly, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users.map(strip));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { username, email, password, role, operations, puedeVerKardex, puedeVerComparativo, puedeVerVentas, puedeVerBajas, puedeVerPronosticoVenta, puedeVerCosteoRecetas, rolPago, sociedadesPago, sociedadesCompra, rolBCT, rol86, accesoBajas, accesoConsumos, accesoTransferencias, acceso86, transferenciaDestinos, rolCaja, accesoOficina, accesoDepositos, rolObligaciones, companiasEBC, accesoEERR, operacionesEERR, accesoConciliacion, sociedadesConciliacion, rolMaestroItems, sociedadesMaestros, rolPagoRecurrente, rolSeguimientoCompras } = req.body;
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: 'El usuario ya existe' });
    const { ops, socs } = await codigosValidos();
    const user = new User({ id: uuidv4(), username, email: email || '', password: await bcrypt.hash(password, 10), role, operations: filtrarCodigos(operations, ops), puedeVerKardex: !!puedeVerKardex, puedeVerComparativo: !!puedeVerComparativo, puedeVerVentas: !!puedeVerVentas, puedeVerBajas: !!puedeVerBajas, puedeVerPronosticoVenta: !!puedeVerPronosticoVenta, puedeVerCosteoRecetas: !!puedeVerCosteoRecetas, rolPago: rolPago || '', sociedadesPago: filtrarCodigos(sociedadesPago, socs), sociedadesCompra: filtrarCodigos(sociedadesCompra, socs), rolBCT: rolBCT || '', rol86: rol86 || '', accesoBajas: !!accesoBajas, accesoConsumos: !!accesoConsumos, accesoTransferencias: !!accesoTransferencias, acceso86: !!acceso86, transferenciaDestinos: filtrarCodigos(transferenciaDestinos, ops), rolCaja: rolCaja || '', accesoOficina: !!accesoOficina, accesoDepositos: !!accesoDepositos, rolObligaciones: rolObligaciones || '', companiasEBC: Array.isArray(companiasEBC) ? companiasEBC : [], accesoEERR: !!accesoEERR, operacionesEERR: Array.isArray(operacionesEERR) ? operacionesEERR : [], accesoConciliacion: !!accesoConciliacion, sociedadesConciliacion: filtrarCodigos(sociedadesConciliacion, socs), rolMaestroItems: rolMaestroItems || '', sociedadesMaestros: filtrarCodigos(sociedadesMaestros, socs), rolPagoRecurrente: rolPagoRecurrente || '', rolSeguimientoCompras: rolSeguimientoCompras || '' });
    await user.save();
    res.json(strip(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { username, email, password, role, operations, puedeVerKardex, puedeVerComparativo, puedeVerVentas, puedeVerBajas, puedeVerPronosticoVenta, puedeVerCosteoRecetas, rolPago, sociedadesPago, sociedadesCompra, rolBCT, rol86, accesoBajas, accesoConsumos, accesoTransferencias, acceso86, transferenciaDestinos, rolCaja, accesoOficina, accesoDepositos, rolObligaciones, companiasEBC, accesoEERR, operacionesEERR, accesoConciliacion, sociedadesConciliacion, rolMaestroItems, sociedadesMaestros, rolPagoRecurrente, rolSeguimientoCompras } = req.body;
    const { ops, socs } = await codigosValidos();
    const update = {
      ...(username !== undefined && { username }),
      ...(email !== undefined && { email }),
      ...(role !== undefined && { role }),
      ...(operations !== undefined && { operations: filtrarCodigos(operations, ops) }),
      ...(password && { password: await bcrypt.hash(password, 10) }),
      ...(puedeVerKardex !== undefined && { puedeVerKardex: !!puedeVerKardex }),
      ...(puedeVerComparativo !== undefined && { puedeVerComparativo: !!puedeVerComparativo }),
      ...(puedeVerVentas !== undefined && { puedeVerVentas: !!puedeVerVentas }),
      ...(puedeVerBajas !== undefined && { puedeVerBajas: !!puedeVerBajas }),
      ...(puedeVerPronosticoVenta !== undefined && { puedeVerPronosticoVenta: !!puedeVerPronosticoVenta }),
      ...(puedeVerCosteoRecetas !== undefined && { puedeVerCosteoRecetas: !!puedeVerCosteoRecetas }),
      ...(rolPago       !== undefined && { rolPago:  rolPago || '' }),
      ...(sociedadesPago !== undefined && { sociedadesPago: filtrarCodigos(sociedadesPago, socs) }),
      ...(sociedadesCompra !== undefined && { sociedadesCompra: filtrarCodigos(sociedadesCompra, socs) }),
      ...(rolBCT !== undefined && { rolBCT: rolBCT || '' }),
      ...(rol86 !== undefined && { rol86: rol86 || '' }),
      ...(accesoBajas !== undefined && { accesoBajas: !!accesoBajas }),
      ...(accesoConsumos !== undefined && { accesoConsumos: !!accesoConsumos }),
      ...(accesoTransferencias !== undefined && { accesoTransferencias: !!accesoTransferencias }),
      ...(acceso86 !== undefined && { acceso86: !!acceso86 }),
      ...(transferenciaDestinos !== undefined && { transferenciaDestinos: filtrarCodigos(transferenciaDestinos, ops) }),
      ...(rolCaja !== undefined && { rolCaja: rolCaja || '' }),
      ...(accesoOficina !== undefined && { accesoOficina: !!accesoOficina }),
      ...(accesoDepositos !== undefined && { accesoDepositos: !!accesoDepositos }),
      ...(rolObligaciones !== undefined && { rolObligaciones: rolObligaciones || '' }),
      ...(companiasEBC !== undefined && { companiasEBC: Array.isArray(companiasEBC) ? companiasEBC : [] }),
      ...(accesoEERR !== undefined && { accesoEERR: !!accesoEERR }),
      ...(operacionesEERR !== undefined && { operacionesEERR: Array.isArray(operacionesEERR) ? operacionesEERR : [] }),
      ...(accesoConciliacion !== undefined && { accesoConciliacion: !!accesoConciliacion }),
      ...(sociedadesConciliacion !== undefined && { sociedadesConciliacion: filtrarCodigos(sociedadesConciliacion, socs) }),
      ...(rolMaestroItems !== undefined && { rolMaestroItems: rolMaestroItems || '' }),
      ...(sociedadesMaestros !== undefined && { sociedadesMaestros: filtrarCodigos(sociedadesMaestros, socs) }),
      ...(rolPagoRecurrente !== undefined && { rolPagoRecurrente: rolPagoRecurrente || '' }),
      ...(rolSeguimientoCompras !== undefined && { rolSeguimientoCompras: rolSeguimientoCompras || '' }),
    };
    const user = await User.findOneAndUpdate({ id: req.params.id }, update, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(strip(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puede eliminarse a sí mismo' });
    const result = await User.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
