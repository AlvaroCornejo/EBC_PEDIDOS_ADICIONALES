require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

// Limpieza de los datos de prueba del módulo Cierre de Caja (Sesión 28) — correr en el
// servidor (CORPSERV-PRUEBA) después de probar el flujo manualmente. Borra TODO el
// contenido de las 4 colecciones transaccionales (turnos, movimientos, envíos, cierres
// de oficina), ya que a la fecha de este script el módulo recién se desplegó y no hay
// uso real todavía. NO toca `cajaefectivoconfigs` — esa es la configuración real
// (tieneOficina/turnos por operación) que el usuario ya dejó armada en Admin.
//
// Uso: node scripts/limpiarCajaEfectivoPrueba.js
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const colecciones = ['turnocajas', 'movimientoefectivocajas', 'envioefectivos', 'cierreoficinadiarios'];
  for (const col of colecciones) {
    const antes = await db.collection(col).countDocuments();
    const { deletedCount } = await db.collection(col).deleteMany({});
    console.log(`${col}: ${deletedCount} documento(s) borrado(s) (había ${antes})`);
  }

  console.log('✓ Limpieza completa. cajaefectivoconfigs no se tocó.');
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
