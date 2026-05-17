const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DATA_DIR),
  filename: (req, file, cb) => {
    const { tipo } = req.query;
    let filename;
    if (tipo === 'maestro') filename = 'maestro_items.xlsx';
    else if (tipo === 'kardex') filename = 'kardex.xlsx';
    else if (tipo === 'costos') filename = 'costos.xlsx';
    else {
      // Preserve original filename (decode from latin1 if needed)
      try {
        filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
      } catch {
        filename = file.originalname;
      }
    }
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xlsm') || file.mimetype.includes('spreadsheet')) cb(null, true);
    else cb(new Error('Solo se aceptan archivos .xlsx o .xlsm'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.use(authMiddleware);

router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    res.json({ success: true, filename: req.file.filename, size: req.file.size });
  });
});

module.exports = router;
