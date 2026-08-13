require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Google DNS — evita bloqueo SRV del router
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const connectDB = require('./db');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data/uploads dir exists for Excel files
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function initUsers() {
  const count = await User.countDocuments();
  if (count > 0) return;

  const users = [
    { id: uuidv4(), username: 'admin',       email: 'admin@empresa.com', password: await bcrypt.hash('admin123', 10), role: 'ADMIN',               operations: ['AASI', 'CDLAO', 'CDL28'] },
    { id: uuidv4(), username: 'aprobador',   email: 'apr@empresa.com',   password: await bcrypt.hash('apr123',   10), role: 'OPERADOR_APROBACION', operations: ['AASI', 'CDLAO', 'CDL28'] },
    { id: uuidv4(), username: 'compras',     email: 'ate@empresa.com',   password: await bcrypt.hash('ate123',   10), role: 'OPERADOR_ATENCION',   operations: ['AASI', 'CDLAO', 'CDL28'] },
    { id: uuidv4(), username: 'AASI',        email: '',                  password: await bcrypt.hash('AASI123',  10), role: 'OPERADOR_SOLICITUD',  operations: ['AASI'] },
    { id: uuidv4(), username: 'CDLAO',       email: '',                  password: await bcrypt.hash('CDLAO123', 10), role: 'OPERADOR_SOLICITUD',  operations: ['CDLAO'] },
    { id: uuidv4(), username: 'CDL28',       email: '',                  password: await bcrypt.hash('CDL28123', 10), role: 'OPERADOR_SOLICITUD',  operations: ['CDL28'] },
  ];

  await User.insertMany(users);
  console.log('Usuarios por defecto creados');
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/pedidos',     require('./routes/pedidos'));
app.use('/api/datos',       require('./routes/datos'));
app.use('/api/upload',      require('./routes/upload'));
app.use('/api/export',      require('./routes/export'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/config',      require('./routes/config').router);
app.use('/api/items',       require('./routes/items'));
app.use('/api/comentarios', require('./routes/comentarios'));
app.use('/api/push',        require('./routes/push'));
app.use('/api/compras',     require('./routes/compras'));
app.use('/api/comparativo', require('./routes/comparativo'));
app.use('/api/ventas',      require('./routes/ventas'));
app.use('/api/pronostico-venta', require('./routes/pronostico-venta'));
app.use('/api/bajas',       require('./routes/bajas'));
app.use('/api/maestro-items', require('./routes/maestro-items'));
app.use('/api/pagos',       require('./routes/pagos'));
app.use('/api/pagos-recurrentes', require('./routes/pagos-recurrentes'));
app.use('/api/personas',    require('./routes/personas'));
app.use('/api/flujo-caja',  require('./routes/flujoCaja'));
app.use('/api/movimientos', require('./routes/movimientos'));
app.use('/api/recetas',    require('./routes/recetas'));
app.use('/api/recetas-costeo', require('./routes/recetas-costeo'));
app.use('/api/caja',       require('./routes/caja'));
app.use('/api/obligaciones-ebc', require('./routes/obligacionesEBC'));
app.use('/api/proyeccion',      require('./routes/proyeccion'));
app.use('/api/eerr',            require('./routes/eerr'));
app.use('/api/conciliacion',    require('./routes/conciliacion'));
app.use('/api/sociedades',      require('./routes/sociedades'));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

connectDB().then(async () => {
  await initUsers();
  app.listen(PORT, () => {
    console.log(`\n=== Sistema de Pedidos ===`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`\nUsuarios por defecto (solo primer arranque):`);
    console.log(`  admin / admin123`);
    console.log(`  aprobador / apr123`);
    console.log(`  compras / ate123`);
    console.log(`  AASI / AASI123`);
    console.log(`  CDLAO / CDLAO123`);
    console.log(`  CDL28 / CDL28123\n`);
  });
});
