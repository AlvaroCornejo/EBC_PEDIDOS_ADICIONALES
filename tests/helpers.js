// Entorno de pruebas: MongoDB en memoria (nunca toca Atlas) + la `app` real de server.js.
process.env.JWT_SECRET = 'test-secret';
process.env.MONGODB_URI = '';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const request  = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

const User    = require('../models/User');
const KpiArea = require('../models/KpiArea');
const { invalidar } = require('../utils/usuariosInactivos');

let mongod;
let app;

async function iniciar() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = require('../server');
  return app;
}

async function detener() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function limpiar() {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map(c => c.deleteMany({})));
  invalidar();
  await KpiArea.asegurarSeed();
}

let seq = 0;
async function crearUsuario(campos = {}) {
  seq++;
  const password = 'clave123';
  const user = await User.create({
    id: `u${seq}`,
    username: campos.username || `usuario${seq}`,
    email: `usuario${seq}@test.pe`,
    password: await bcrypt.hash(password, 4),
    mustChangePassword: false,
    ...campos,
  });
  return { user, password };
}

async function login(user, password = 'clave123') {
  const r = await request(app).post('/api/auth/login').send({ username: user.username, password });
  return r.body.token;
}

// Crea el usuario y devuelve un agente con su token ya puesto.
async function comoUsuario(campos = {}) {
  const { user } = await crearUsuario(campos);
  const token = await login(user);
  const conToken = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    user, token,
    get:    (url)       => conToken(request(app).get(url)),
    post:   (url, body) => conToken(request(app).post(url)).send(body),
    put:    (url, body) => conToken(request(app).put(url)).send(body),
    delete: (url)       => conToken(request(app).delete(url)),
  };
}

module.exports = { iniciar, detener, limpiar, crearUsuario, login, comoUsuario, request: () => request(app) };
