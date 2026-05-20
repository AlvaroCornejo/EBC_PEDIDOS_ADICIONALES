const webpush = require('web-push');
const PushSub = require('../models/PushSub');

// Inicializar VAPID una sola vez
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@empresa.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * Envía una notificación push a todos los usuarios que coincidan con el filtro.
 * filter: objeto Mongoose query sobre PushSub (ej: { role: 'OPERADOR_APROBACION', operations: operacion })
 * payload: { title, body, url }
 */
async function sendPush(filter, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return; // Push no configurado
  try {
    const subs = await PushSub.find(filter).lean();
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      } catch (err) {
        // Suscripción expirada o inválida → eliminar
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSub.deleteOne({ _id: sub._id });
        }
      }
    }
  } catch (err) {
    console.error('sendPush error:', err.message);
  }
}

module.exports = { sendPush };
