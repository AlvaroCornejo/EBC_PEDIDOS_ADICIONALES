const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Operacion = require('../models/Operacion');
const Sociedad  = require('../models/Sociedad');
const KpiArea   = require('../models/KpiArea');
const { invalidar: invalidarInactivos } = require('../utils/usuariosInactivos');

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

// Indicadores GAF: una entrada por área (la última gana si viene repetida), solo
// áreas existentes en el catálogo y niveles válidos.
async function filtrarKpiAreas(kpiAreas) {
  if (!Array.isArray(kpiAreas)) return [];
  const validas = new Set(await KpiArea.distinct('codigo'));
  const porArea = new Map();
  for (const a of kpiAreas) {
    if (a && validas.has(a.area) && ['CAPTURA', 'LECTURA'].includes(a.nivel)) porArea.set(a.area, a.nivel);
  }
  return [...porArea].map(([area, nivel]) => ({ area, nivel }));
}
const KPI_ROLES = ['', 'admin', 'lector'];

router.use(authMiddleware);

router.get('/', adminOnly, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users.map(strip));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { username, email, password, role, operations, puedeVerKardex, puedeVerComparativo, puedeVerVentas, puedeVerBajas, puedeVerCosteoRecetas, rolPago, sociedadesPago, sociedadesCompra, rolBCT, rol86, accesoBajas, accesoConsumos, accesoTransferencias, acceso86, transferenciaDestinos, accesoEERR, operacionesEERR, accesoConciliacion, sociedadesConciliacion, rolCambioReceta, accesoSaldoBanco, accesoFlujoCaja, rolPlanilla, accesoPlanillas, accesoInventarios, kpiRol, kpiAreas } = req.body;
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: 'El usuario ya existe' });
    if (kpiRol !== undefined && !KPI_ROLES.includes(kpiRol)) return res.status(400).json({ error: 'Rol de Indicadores inválido' });
    const { ops, socs } = await codigosValidos();
    const user = new User({ id: uuidv4(), username, email: email || '', password: await bcrypt.hash(password, 10), role, operations: filtrarCodigos(operations, ops), puedeVerKardex: !!puedeVerKardex, puedeVerComparativo: !!puedeVerComparativo, puedeVerVentas: !!puedeVerVentas, puedeVerBajas: !!puedeVerBajas, puedeVerCosteoRecetas: !!puedeVerCosteoRecetas, rolPago: rolPago || '', sociedadesPago: filtrarCodigos(sociedadesPago, socs), sociedadesCompra: filtrarCodigos(sociedadesCompra, socs), rolBCT: rolBCT || '', rol86: rol86 || '', accesoBajas: !!accesoBajas, accesoConsumos: !!accesoConsumos, accesoTransferencias: !!accesoTransferencias, acceso86: !!acceso86, transferenciaDestinos: filtrarCodigos(transferenciaDestinos, ops), accesoEERR: !!accesoEERR, operacionesEERR: Array.isArray(operacionesEERR) ? operacionesEERR : [], accesoConciliacion: !!accesoConciliacion, sociedadesConciliacion: filtrarCodigos(sociedadesConciliacion, socs), rolCambioReceta: rolCambioReceta || '', accesoSaldoBanco: !!accesoSaldoBanco, accesoFlujoCaja: !!accesoFlujoCaja, rolPlanilla: rolPlanilla || '', accesoPlanillas: !!accesoPlanillas, accesoInventarios: !!accesoInventarios, kpiRol: kpiRol || '', kpiAreas: await filtrarKpiAreas(kpiAreas) });
    await user.save();
    res.json(strip(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { username, email, password, role, operations, puedeVerKardex, puedeVerComparativo, puedeVerVentas, puedeVerBajas, puedeVerCosteoRecetas, rolPago, sociedadesPago, sociedadesCompra, rolBCT, rol86, accesoBajas, accesoConsumos, accesoTransferencias, acceso86, transferenciaDestinos, accesoEERR, operacionesEERR, accesoConciliacion, sociedadesConciliacion, rolCambioReceta, accesoSaldoBanco, accesoFlujoCaja, rolPlanilla, accesoPlanillas, accesoInventarios, activo, kpiRol, kpiAreas } = req.body;
    if (activo === false && req.params.id === req.user.id) return res.status(400).json({ error: 'No puede desactivarse a sí mismo' });
    if (kpiRol !== undefined && !KPI_ROLES.includes(kpiRol)) return res.status(400).json({ error: 'Rol de Indicadores inválido' });
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
      ...(accesoEERR !== undefined && { accesoEERR: !!accesoEERR }),
      ...(operacionesEERR !== undefined && { operacionesEERR: Array.isArray(operacionesEERR) ? operacionesEERR : [] }),
      ...(accesoConciliacion !== undefined && { accesoConciliacion: !!accesoConciliacion }),
      ...(sociedadesConciliacion !== undefined && { sociedadesConciliacion: filtrarCodigos(sociedadesConciliacion, socs) }),
      ...(rolCambioReceta !== undefined && { rolCambioReceta: rolCambioReceta || '' }),
      ...(accesoSaldoBanco !== undefined && { accesoSaldoBanco: !!accesoSaldoBanco }),
      ...(accesoFlujoCaja !== undefined && { accesoFlujoCaja: !!accesoFlujoCaja }),
      ...(rolPlanilla !== undefined && { rolPlanilla: rolPlanilla || '' }),
      ...(accesoPlanillas !== undefined && { accesoPlanillas: !!accesoPlanillas }),
      ...(accesoInventarios !== undefined && { accesoInventarios: !!accesoInventarios }),
      ...(activo !== undefined && { activo: !!activo }),
      ...(kpiRol !== undefined && { kpiRol: kpiRol || '' }),
      ...(kpiAreas !== undefined && { kpiAreas: await filtrarKpiAreas(kpiAreas) }),
    };
    const user = await User.findOneAndUpdate({ id: req.params.id }, update, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (activo !== undefined) invalidarInactivos();
    res.json(strip(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sin borrado físico: DELETE desactiva (activo=false). El usuario pierde acceso a toda
// la app pero su historial (auditorías, registros) sigue apuntando a un usuario real.
// Se reactiva con PUT /:id { activo: true }.
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puede desactivarse a sí mismo' });
    const result = await User.updateOne({ id: req.params.id }, { activo: false });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    invalidarInactivos();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
