const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI no está definida en las variables de entorno');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log('MongoDB conectado');
  } catch (err) {
    console.error('Error conectando a MongoDB:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
