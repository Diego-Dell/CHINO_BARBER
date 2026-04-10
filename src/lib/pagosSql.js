/**
 * Pagos financieros: columna `estado` = ciclo de vida ('activo'|'anulado').
 * Columna `cobro_estado` = negocio ('Pagado'|'Pendiente').
 * Suma de cobros válidos: solo activos y efectivamente pagados.
 */
function sqlPagoCuentaFinanciera(alias = "p") {
  return `${alias}.estado = 'activo' AND ${alias}.cobro_estado = 'Pagado'`;
}

/** Alias semántico para reportes (misma regla). */
const sqlPagoIngreso = sqlPagoCuentaFinanciera;

module.exports = { sqlPagoCuentaFinanciera, sqlPagoIngreso };
