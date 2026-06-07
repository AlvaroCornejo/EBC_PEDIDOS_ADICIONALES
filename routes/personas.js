const express  = require('express');
const router   = express.Router();
const auth            = require('../middleware/auth');
const Persona          = require('../models/Persona');
const CopiaCorreo      = require('../models/CopiaCorreo');
const PagoProgramacion = require('../models/PagoProgramacion');
const { getSmtpConfig, buildTransport } = require('../utils/sendEmail');

router.use(auth);

// ── helpers ───────────────────────────────────────────────────────
const esc  = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtN = v => Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD = d => d ? new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';

// ── Personas ──────────────────────────────────────────────────────

// GET /personas?compania=X  (montado en /api/personas)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.compania) filter.compania = req.query.compania;
    const list = await Persona.find(filter).sort({ nombre: 1 }).lean();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /personas/sin-correo?compania=X
router.get('/sin-correo', async (req, res) => {
  try {
    const filter = { $or: [{ correos: { $size: 0 } }, { correos: { $exists: false } }] };
    if (req.query.compania) filter.compania = req.query.compania;
    const list = await Persona.find(filter).sort({ nombre: 1 }).lean();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /personas
router.post('/', async (req, res) => {
  try {
    const puedeGestionar = req.user.role === 'ADMIN' || ['pagador','admin'].includes(req.user.rolPago);
    if (!puedeGestionar) return res.status(403).json({ error: 'No autorizado' });
    const { nombre, telefono, correos, compania } = req.body;
    const persona = await Persona.create({
      nombre, telefono: telefono || '',
      correos: (correos || []).filter(Boolean),
      compania, creadoPor: req.user.username,
    });
    res.json(persona);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe esa persona en esta sociedad' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /personas/:id
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admin' });
    const { nombre, telefono, correos } = req.body;
    const persona = await Persona.findByIdAndUpdate(
      req.params.id,
      { nombre, telefono: telefono || '',
        correos: (correos || []).filter(Boolean),
        actualizadoEn: new Date() },
      { new: true }
    );
    if (!persona) return res.status(404).json({ error: 'No encontrada' });
    res.json(persona);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /personas/:id
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admin' });
    await Persona.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /personas/bulk-upsert  — inserta personas nuevas, no toca las existentes
router.post('/bulk-upsert', async (req, res) => {
  try {
    const { personas } = req.body; // [{ nombre, compania }]
    if (!Array.isArray(personas)) return res.status(400).json({ error: 'personas debe ser array' });
    let created = 0, existing = 0;
    for (const p of personas) {
      if (!p.nombre?.trim() || !p.compania?.trim()) continue;
      const exists = await Persona.findOne({ nombre: p.nombre.trim(), compania: p.compania.trim() });
      if (!exists) {
        await Persona.create({
          nombre: p.nombre.trim(), compania: p.compania.trim(),
          correos: [], creadoPor: req.user.username,
        });
        created++;
      } else {
        existing++;
      }
    }
    res.json({ ok: true, created, existing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /personas/:id/correo-rapido  — agrega correo a persona existente (desde P5)
router.put('/:id/correo-rapido', async (req, res) => {
  try {
    const { correos } = req.body;
    const persona = await Persona.findByIdAndUpdate(
      req.params.id,
      { correos: (correos || []).filter(Boolean), actualizadoEn: new Date() },
      { new: true }
    );
    if (!persona) return res.status(404).json({ error: 'No encontrada' });
    res.json(persona);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Copias de correo por sociedad ─────────────────────────────────

// GET /copias-correo?compania=X
router.get('/copias-correo', async (req, res) => {
  try {
    const filter = {};
    if (req.query.compania) filter.compania = req.query.compania;
    const list = await CopiaCorreo.find(filter).lean();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /copias-correo/:compania
router.put('/copias-correo/:compania', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admin' });
    const { correos } = req.body;
    const doc = await CopiaCorreo.findOneAndUpdate(
      { compania: req.params.compania },
      { correos: (correos || []).filter(Boolean), actualizadoEn: new Date() },
      { upsert: true, new: true }
    );
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Enviar correo de pago ─────────────────────────────────────────
// POST /enviar-correo-pago
// body: { progId, banco, moneda, operacionBancaria }
// Envía un correo por beneficiario con las obligaciones pagadas de esa operación.
// Si banco/moneda/op son vacíos, incluye todas las obligaciones pagadas de la programación.
router.post('/enviar-correo-pago', async (req, res) => {
  try {
    const { progId, banco, moneda, operacionBancaria } = req.body;
    if (!progId) return res.status(400).json({ error: 'Falta progId' });

    const prog = await PagoProgramacion.findById(progId).lean();
    if (!prog) return res.status(404).json({ error: 'Programación no encontrada' });

    const cfg     = await getSmtpConfig();
    const enabled = cfg.smtpEnabled === true || cfg.smtpEnabled === 'true';
    if (!enabled || !cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
      return res.status(400).json({ error: 'SMTP no configurado. Vaya a Admin → Configuración.' });
    }

    const opStr = operacionBancaria ? String(operacionBancaria).trim() : '';

    // Filtrar obligaciones pagadas que coincidan con banco/moneda/op (si se especifican)
    const obligaciones = (prog.obligaciones || []).filter(ob => {
      if (!ob.seleccionado || !ob.pagada) return false;
      if (banco) {
        if ((ob.p5Banco || ob.bancoAsignado || '') !== banco) return false;
      }
      if (moneda) {
        const obMon = ob.p5Moneda || (ob.moneda === 'LO' ? 'SOL' : 'USD');
        if (obMon !== moneda) return false;
      }
      if (opStr) {
        if (String(ob.operacionBancaria || '').trim() !== opStr) return false;
      }
      return true;
    });

    if (!obligaciones.length) {
      return res.status(400).json({ error: 'No hay obligaciones pagadas para los filtros indicados' });
    }

    // Agrupar por beneficiario
    const byBenef = {};
    obligaciones.forEach(ob => {
      const k = ob.pagarA || '(sin beneficiario)';
      if (!byBenef[k]) byBenef[k] = [];
      byBenef[k].push(ob);
    });

    // CC de la sociedad
    const copiaDoc  = await CopiaCorreo.findOne({ compania: prog.compania }).lean();
    const ccEmails  = (copiaDoc?.correos || []).filter(Boolean);
    const transporter = buildTransport(cfg);

    let sent = 0;
    const sinCorreo = [];

    for (const [benef, obs] of Object.entries(byBenef)) {
      const persona = await Persona.findOne({
        nombre: benef, compania: prog.compania
      }).lean();
      const toEmails = (persona?.correos || []).filter(Boolean);

      if (!toEmails.length) { sinCorreo.push(benef); continue; }

      const monLabel = banco && moneda ? ` — ${banco} ${moneda}` : '';
      const opLabel  = opStr ? ` | N° Op. ${opStr}` : '';

      const rows = obs.map(ob => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(ob.tipoDocumento||'')}&nbsp;${esc(ob.numeroDocumento||'')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${fmtD(ob.fechaDocumento)}</td>
          <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb">${esc(ob.moneda||'')}</td>
          <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600">${fmtN(ob.monto||0)}</td>
          <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb">${(ob.retencion||0)>0?fmtN(ob.retencion):'—'}</td>
          <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:700;color:#15803d">${fmtN((ob.monto||0)-(ob.retencion||0))}</td>
        </tr>`).join('');

      const totalNeto = obs.reduce((s,ob) => s + (ob.monto||0) - (ob.retencion||0), 0);

      const html = `
<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto">
  <div style="background:#1d4ed8;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">Notificación de Pago</h2>
    <p style="margin:4px 0 0;opacity:0.85;font-size:13px">${esc(prog.compania)} — Semana ${prog.semana||''}/${prog.año||''}${monLabel}${opLabel}</p>
  </div>
  <div style="padding:20px 28px;background:#fff;border:1px solid #e5e7eb;border-top:none">
    <p style="margin:0 0 16px;font-size:14px">Estimado/a <strong>${esc(benef)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px">Le informamos que se ha procesado el pago de los siguientes documentos:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #cbd5e1">Documento</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #cbd5e1;white-space:nowrap">F. Emisión</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #cbd5e1">Mon</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #cbd5e1">Importe</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #cbd5e1">Retención</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #cbd5e1;white-space:nowrap">Neto Abonado</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:#f0fdf4">
          <td colspan="5" style="padding:8px 10px;font-weight:700;text-align:right;font-size:13px">Total Neto:</td>
          <td style="padding:8px 10px;font-weight:700;text-align:right;font-size:15px;color:#15803d">${fmtN(totalNeto)}</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin:20px 0 0;font-size:11px;color:#9ca3af">Mensaje automático generado por el sistema de pagos de ${esc(prog.compania)}. Por favor no responda a este correo.</p>
  </div>
</div>`;

      await transporter.sendMail({
        from:    cfg.smtpFrom || cfg.smtpUser,
        to:      toEmails.join(', '),
        cc:      ccEmails.length ? ccEmails.join(', ') : undefined,
        subject: `Notificación de Pago — ${prog.compania} Sem ${prog.semana}/${prog.año}${opLabel}`,
        html,
      });
      sent++;
    }

    res.json({ ok: true, sent, sinCorreo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
