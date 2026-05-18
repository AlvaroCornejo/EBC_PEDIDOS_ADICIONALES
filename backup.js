/**
 * backup.js — Genera copia de seguridad de la BD y la guarda en Box
 * Uso: node backup.js
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const User = require('./models/User');
const Pedido = require('./models/Pedido');

const BACKUP_DIR = 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC LOGISTICA\\EBC ADCIONALES';

async function backup() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB conectado');

    // Obtener datos
    const users = await User.find().lean();
    const pedidos = await Pedido.find().lean();

    // Crear nombre de archivo con fecha
    const fecha = new Date().toISOString().split('T')[0];
    const filename = `pedidos-backup-${fecha}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Guardar archivo
    const data = { exportedAt: new Date().toISOString(), users, pedidos };
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

    console.log(`✔ Backup guardado: ${filepath}`);
    console.log(`  Usuarios: ${users.length} | Pedidos: ${pedidos.length}`);
  } catch (err) {
    console.error('Error en backup:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

backup();
