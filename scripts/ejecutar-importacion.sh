#!/bin/bash
# ============================================================
#  Importación semanal de Compras Históricas a MongoDB
#  Cron: cada lunes a las 6:00 AM (servidor DigitalOcean)
# ============================================================

# ── Rutas — ajustar según el servidor ──────────────────────
APP_DIR="/root/pedidos-app"          # directorio de la app en el servidor
EXCEL_FILE="/root/datos/EBC COMPRAS HISTORICAS.xlsx"  # ruta del Excel en el servidor
LOG_FILE="$APP_DIR/scripts/importacion.log"

# ── Asegurarse de usar el node correcto (nvm si aplica) ────
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ── Log ────────────────────────────────────────────────────
echo "" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
echo "Inicio: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# ── Verificar que el Excel existe ──────────────────────────
if [ ! -f "$EXCEL_FILE" ]; then
    echo "ERROR: No se encontró el archivo Excel:" >> "$LOG_FILE"
    echo "  $EXCEL_FILE" >> "$LOG_FILE"
    exit 1
fi

# ── Ejecutar importación ───────────────────────────────────
cd "$APP_DIR"
node scripts/importCompras.js "$EXCEL_FILE" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "Resultado: EXITOSO" >> "$LOG_FILE"
else
    echo "Resultado: ERROR (código $EXIT_CODE)" >> "$LOG_FILE"
fi

echo "Fin: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
exit $EXIT_CODE
