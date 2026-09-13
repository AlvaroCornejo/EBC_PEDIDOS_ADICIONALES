require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

// Migración única: Actividad.sociedadCodigo (string) -> sociedadCodigos ([String]),
// y agrega TODAS al enum de nivelAsignacion. Ver CLAUDE.md Sesión 15 (ampliación).
// Ya ejecutada en prod — no volver a correr salvo que se detecten documentos viejos.
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const actividadesViejas = await db.collection('actividads').find({
    nivelAsignacion: 'SOCIEDAD', sociedadCodigo: { $exists: true }, sociedadCodigos: { $exists: false },
  }).toArray();
  for (const a of actividadesViejas) {
    await db.collection('actividads').updateOne(
      { _id: a._id },
      { $set: { sociedadCodigos: [a.sociedadCodigo] }, $unset: { sociedadCodigo: '' } }
    );
  }

  const instanciasViejas = await db.collection('actividadcierres').find({
    nivelAsignacion: 'SOCIEDAD', sociedadCodigo: { $exists: true }, sociedadCodigos: { $exists: false },
  }).toArray();
  for (const a of instanciasViejas) {
    await db.collection('actividadcierres').updateOne(
      { _id: a._id },
      { $set: { sociedadCodigos: [a.sociedadCodigo] }, $unset: { sociedadCodigo: '' } }
    );
  }

  console.log(`✓ ${actividadesViejas.length} Actividad(es) y ${instanciasViejas.length} ActividadCierre migradas`);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
