const express  = require('express');
const ExcelJS  = require('exceljs');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * POST /api/export/tabla — convierte tablas ya armadas en el frontend (scrapeadas del
 * DOM, mismo dato que antes se bajaba como CSV) en un .xlsx real, una hoja por tabla.
 * body: { nombreArchivo, hojas: [{ nombre, filas: [[celda, ...], ...] }] }
 */
router.post('/tabla', async (req, res) => {
  try {
    const { nombreArchivo, hojas } = req.body;
    if (!Array.isArray(hojas) || !hojas.length) return res.status(400).json({ error: 'Sin datos para exportar' });

    const wb = new ExcelJS.Workbook();
    const nombresUsados = new Set();
    hojas.forEach((h, i) => {
      let nombre = String(h.nombre || `Hoja${i + 1}`).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || `Hoja${i + 1}`;
      let final = nombre, n = 2;
      while (nombresUsados.has(final)) final = `${nombre.slice(0, 28)} (${n++})`;
      nombresUsados.add(final);

      const ws = wb.addWorksheet(final);
      (h.filas || []).forEach(fila => ws.addRow(Array.isArray(fila) ? fila : []));
      if (ws.rowCount) {
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } }; });
      }
      ws.columns.forEach(col => {
        let max = 10;
        col.eachCell({ includeEmpty: true }, c => { max = Math.max(max, String(c.value ?? '').length + 2); });
        col.width = Math.min(max, 40);
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    });

    const nombreLimpio = String(nombreArchivo || 'export').replace(/[\\/*?:[\]]/g, '-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreLimpio}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
