/**
 * Fechas:
 * - Negocio (Bolivia): YYYY-MM-DD en timezone America/La_Paz (UTC-4)
 * - Técnico (auditoría): timestamps UTC (SQLite datetime('now'))
 */
const TZ_BO = "America/La_Paz";

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").slice(0, 10));
}

function boliviaTodayISO() {
  // Formato YYYY-MM-DD (en-CA) estable para ISO-like date.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_BO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// SQLite expressions (string) para usar en SQL, sin mezclar reglas.
const SQL_DATE_BO = "date('now','-4 hours')"; // negocio Bolivia
const SQL_DATETIME_UTC = "datetime('now')"; // técnico UTC

module.exports = { TZ_BO, isISODate, boliviaTodayISO, SQL_DATE_BO, SQL_DATETIME_UTC };

