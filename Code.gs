/**
 * ASISTENCIA QR — Backend en Google Apps Script
 * ------------------------------------------------------------
 * Control de asistencia con carnets y código QR para colegios
 * (alumnos) y empresas (colaboradores). Los datos viven en esta
 * hoja de cálculo; la app web (index.html) se conecta a esta API.
 *
 * Instalación rápida:
 *   1. Pega este archivo en Extensiones > Apps Script de la hoja.
 *   2. Ejecuta la función `instalar` (autoriza los permisos).
 *   3. Implementar > Nueva implementación > Aplicación web
 *      Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 *   4. Copia la URL que termina en /exec y pégala en la app.
 */

const VERSION = '1.0.0';
const HOJA_CONFIG = 'Config';
const HOJA_PERSONAS = 'Personas';
const HOJA_ASIS = 'Asistencias';

const COLS_P = ['ID', 'Nombres', 'Apellidos', 'Grupo', 'Seccion', 'Documento', 'FotoURL', 'Token', 'Activo', 'Creado'];
const COLS_A = ['Fecha', 'Hora', 'ID', 'Nombre', 'Grupo', 'Seccion', 'Tipo', 'Estado', 'Dispositivo'];

const CONFIG_DEFAULT = {
  NOMBRE_ORG: 'Mi Colegio',
  TIPO_ORG: 'Colegio',              // Colegio | Empresa
  LEYENDA: 'Año lectivo ' + new Date().getFullYear(),
  MODO: 'Solo entrada',             // Solo entrada | Entrada y salida
  HORA_ENTRADA: '07:00',
  HORA_SALIDA: '17:00',
  TOLERANCIA_MIN: '10',
  ANTIREBOTE_MIN: '2',
  COLOR_1: '#7a1424',
  COLOR_2: '#c026d3',
  COLOR_3: '#f5c542',
  LOGO_URL: '',
  CLAVE_ADMIN: '',
  CLAVE_ESCANER: '',
  CARPETA_ID: ''
};
const CLAVES_ACCESO = ['CLAVE_ADMIN', 'CLAVE_ESCANER'];

/* ================= MENÚ E INSTALACIÓN ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Asistencia QR')
    .addItem('Instalar / reparar', 'instalar')
    .addItem('Ver claves de acceso', 'verClaves')
    .addItem('Generar claves nuevas', 'regenerarClaves')
    .addToUi();
}

function instalar() {
  hoja_(HOJA_CONFIG, ['Clave', 'Valor']);
  hoja_(HOJA_PERSONAS, COLS_P);
  hoja_(HOJA_ASIS, COLS_A);

  const cfg = leerConfig_();
  const faltantes = {};
  Object.keys(CONFIG_DEFAULT).forEach(k => {
    if (cfg[k] === undefined || (CLAVES_ACCESO.includes(k) && !cfg[k])) {
      faltantes[k] = CLAVES_ACCESO.includes(k) ? nuevaClave_(k === 'CLAVE_ESCANER') : CONFIG_DEFAULT[k];
    }
  });
  if (Object.keys(faltantes).length) setConfig_(faltantes);
  carpetaFotos_(leerConfig_());
  verClaves();
}

function verClaves() {
  const c = leerConfig_();
  const msg = 'Clave ADMINISTRADOR: ' + c.CLAVE_ADMIN + '\nClave ESCÁNER (porteros/docentes): ' + c.CLAVE_ESCANER +
    '\n\nCámbialas en la hoja "Config" o desde Ajustes en la app.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Asistencia QR', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

function regenerarClaves() {
  setConfig_({ CLAVE_ADMIN: nuevaClave_(false), CLAVE_ESCANER: nuevaClave_(true) });
  verClaves();
}

/* ================= API ================= */

function doGet() {
  return json_({ ok: true, app: 'Asistencia QR', version: VERSION });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = enrutar_(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(res);
}

function enrutar_(req) {
  const cfg = leerConfig_();
  if (!cfg.CLAVE_ADMIN) throw new Error('El sistema no está instalado. Ejecuta "instalar" en Apps Script.');
  const clave = String(req.clave || '').trim();
  const rol = clave && clave === cfg.CLAVE_ADMIN ? 'admin' : (clave && clave === cfg.CLAVE_ESCANER ? 'escaner' : null);
  if (!rol) throw new Error('Clave incorrecta');

  const soloAdmin = ['personas', 'guardarPersona', 'importarPersonas', 'estadoPersona', 'nuevoToken', 'guardarConfig', 'subirLogo', 'reporte'];
  if (soloAdmin.indexOf(req.accion) >= 0 && rol !== 'admin') throw new Error('Esta opción requiere la clave de administrador');

  switch (req.accion) {
    case 'login':            return { ok: true, rol: rol, config: configPublica_(cfg, rol), version: VERSION };
    case 'escanear':         return escanear_(req, cfg, rol);
    case 'resumen':          return resumen_(req.fecha, cfg);
    case 'personas':         return { ok: true, personas: leerPersonas_() };
    case 'guardarPersona':   return guardarPersona_(req, cfg);
    case 'importarPersonas': return importarPersonas_(req.filas || [], cfg);
    case 'estadoPersona':    return estadoPersona_(req.id, req.activo);
    case 'nuevoToken':       return nuevoToken_(req.id);
    case 'guardarConfig':    return guardarConfig_(req.valores || {});
    case 'subirLogo':        return subirLogo_(req, cfg);
    case 'reporte':          return reporte_(req.desde, req.hasta);
    default: throw new Error('Acción desconocida: ' + req.accion);
  }
}

/* ================= ESCANEO ================= */

function escanear_(req, cfg, rol) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const personas = leerPersonas_();
    let p = null;
    let tok = String(req.token || '').trim();
    if (tok.indexOf('AQR:') === 0) tok = tok.slice(4);
    if (tok) {
      p = personas.find(x => x.token === tok);
    } else if (req.id && rol === 'admin') {
      const q = String(req.id).trim().toUpperCase();
      p = personas.find(x => x.id.toUpperCase() === q || (x.documento && x.documento.toUpperCase() === q));
    }
    if (!p) return { ok: true, resultado: 'invalido', mensaje: 'Código no reconocido' };
    if (p.activo === 'No') return { ok: true, resultado: 'inactivo', persona: publica_(p), mensaje: 'Carnet desactivado' };

    const tz = Session.getScriptTimeZone();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, tz, 'yyyy-MM-dd');
    const hora = Utilities.formatDate(ahora, tz, 'HH:mm:ss');
    const hoy = registrosDelDia_(fecha);
    const mios = hoy.filter(r => r.id === p.id);
    const ultimo = mios[mios.length - 1];
    const presentes = new Set(hoy.filter(r => r.tipo === 'Entrada').map(r => r.id));

    let tipo = 'Entrada';
    if (ultimo) {
      const minutos = (seg_(hora) - seg_(ultimo.hora)) / 60;
      if (cfg.MODO !== 'Entrada y salida') {
        return { ok: true, resultado: 'repetido', persona: publica_(p), presentes: presentes.size,
          mensaje: 'Ya registró su entrada hoy a las ' + ultimo.hora.slice(0, 5) };
      }
      if (minutos < Number(cfg.ANTIREBOTE_MIN || 2)) {
        return { ok: true, resultado: 'repetido', persona: publica_(p), presentes: presentes.size,
          mensaje: 'Ya se registró (' + ultimo.tipo.toLowerCase() + ' ' + ultimo.hora.slice(0, 5) + ')' };
      }
      tipo = ultimo.tipo === 'Entrada' ? 'Salida' : 'Entrada';
    }

    let estado;
    if (tipo === 'Entrada') {
      const primera = !mios.some(r => r.tipo === 'Entrada');
      const limite = seg_(cfg.HORA_ENTRADA || '00:00') + Number(cfg.TOLERANCIA_MIN || 0) * 60;
      estado = primera ? (seg_(hora) > limite ? 'Tarde' : 'A tiempo') : 'Reingreso';
      presentes.add(p.id);
    } else {
      estado = seg_(hora) < seg_(cfg.HORA_SALIDA || '23:59') ? 'Salida anticipada' : 'Normal';
    }

    agregarFilas_(hoja_(HOJA_ASIS, COLS_A), [[fecha, hora, p.id, nombreCompleto_(p), p.grupo, p.seccion, tipo, estado,
      String(req.dispositivo || rol).slice(0, 60)]]);

    return { ok: true, resultado: 'registrado', persona: publica_(p),
      registro: { fecha: fecha, hora: hora, tipo: tipo, estado: estado }, presentes: presentes.size };
  } finally {
    lock.releaseLock();
  }
}

/* ================= RESUMEN Y REPORTES ================= */

function resumen_(fecha, cfg) {
  const tz = Session.getScriptTimeZone();
  fecha = fecha || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const activos = leerPersonas_().filter(p => p.activo !== 'No');
  const regs = registrosDelDia_(fecha);

  const primera = {}, ultimo = {};
  regs.forEach(r => {
    if (r.tipo === 'Entrada' && !primera[r.id]) primera[r.id] = r;
    ultimo[r.id] = r;
  });

  const porGrupo = {};
  activos.forEach(p => {
    const g = p.grupo || 'Sin grupo';
    porGrupo[g] = porGrupo[g] || { total: 0, presentes: 0 };
    porGrupo[g].total++;
    if (primera[p.id]) porGrupo[g].presentes++;
  });

  const ausentes = activos.filter(p => !primera[p.id])
    .map(p => ({ id: p.id, nombre: nombreCompleto_(p), grupo: p.grupo, seccion: p.seccion, foto: p.foto }));
  const tarde = Object.keys(primera).filter(id => primera[id].estado === 'Tarde').length;
  const adentro = Object.keys(ultimo).filter(id => ultimo[id].tipo === 'Entrada').length;

  return {
    ok: true, fecha: fecha, modo: cfg.MODO,
    total: activos.length, presentes: Object.keys(primera).length, tarde: tarde, adentro: adentro,
    ausentes: ausentes, porGrupo: porGrupo,
    ultimos: regs.slice(-50).reverse()
  };
}

function reporte_(desde, hasta) {
  const sh = hoja_(HOJA_ASIS, COLS_A);
  const n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, filas: [] };
  desde = desde || '0000-00-00';
  hasta = hasta || '9999-99-99';
  const filas = sh.getRange(2, 1, n, COLS_A.length).getDisplayValues()
    .filter(r => r[0] >= desde && r[0] <= hasta);
  return { ok: true, columnas: COLS_A, filas: filas.slice(-30000) };
}

/** Lee las asistencias de un día recorriendo la hoja desde abajo (los registros se agregan en orden). */
function registrosDelDia_(fecha) {
  const sh = hoja_(HOJA_ASIS, COLS_A);
  let fin = sh.getLastRow();
  const salida = [];
  while (fin >= 2) {
    const ini = Math.max(2, fin - 1999);
    const vals = sh.getRange(ini, 1, fin - ini + 1, COLS_A.length).getDisplayValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i][0] === fecha) salida.push(vals[i]);
    }
    if (vals[0][0] < fecha) break;
    fin = ini - 1;
  }
  return salida.reverse().map(r => ({
    fecha: r[0], hora: r[1], id: r[2], nombre: r[3], grupo: r[4], seccion: r[5], tipo: r[6], estado: r[7], dispositivo: r[8]
  }));
}

/* ================= PERSONAS ================= */

function leerPersonas_() {
  const sh = hoja_(HOJA_PERSONAS, COLS_P);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLS_P.length).getDisplayValues()
    .map((r, i) => ({
      fila: i + 2, id: r[0], nombres: r[1], apellidos: r[2], grupo: r[3], seccion: r[4], documento: r[5],
      foto: r[6], token: r[7], activo: r[8] || 'Sí', creado: r[9]
    }))
    .filter(p => p.id);
}

function guardarPersona_(req, cfg) {
  const d = req.persona || {};
  if (!String(d.nombres || '').trim()) throw new Error('El nombre es obligatorio');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hoja_(HOJA_PERSONAS, COLS_P);
    const personas = leerPersonas_();
    const p = d.id ? personas.find(x => x.id === d.id) : null;
    const id = p ? p.id : siguienteId_(personas, cfg, 1)[0];
    let foto = p ? p.foto : '';
    if (d.foto !== undefined && !req.fotoBase64) foto = d.foto;
    if (req.fotoBase64) foto = guardarImagen_(req.fotoBase64, 'image/jpeg', id + '.jpg', cfg, p && p.foto);

    if (p) {
      const fila = [p.id, d.nombres, d.apellidos || '', d.grupo || '', d.seccion || '', d.documento || '', foto, p.token,
        d.activo === 'No' ? 'No' : 'Sí', p.creado];
      sh.getRange(p.fila, 1, 1, COLS_P.length).setNumberFormat('@').setValues([fila.map(String)]);
      return { ok: true, persona: filaAPersona_(fila) };
    }
    const fila = [id, d.nombres, d.apellidos || '', d.grupo || '', d.seccion || '', d.documento || '', foto, nuevoTokenStr_(),
      d.activo === 'No' ? 'No' : 'Sí', hoyStr_()];
    agregarFilas_(sh, [fila]);
    return { ok: true, persona: filaAPersona_(fila) };
  } finally {
    lock.releaseLock();
  }
}

function importarPersonas_(filas, cfg) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = hoja_(HOJA_PERSONAS, COLS_P);
    const personas = leerPersonas_();
    const docs = new Set(personas.map(p => String(p.documento || '').toUpperCase()).filter(Boolean));
    const validas = [];
    let omitidos = 0;
    filas.forEach(f => {
      const nombres = String(f.nombres || '').trim();
      const doc = String(f.documento || '').trim();
      if (!nombres || (doc && docs.has(doc.toUpperCase()))) { omitidos++; return; }
      if (doc) docs.add(doc.toUpperCase());
      validas.push(f);
    });
    const ids = siguienteId_(personas, cfg, validas.length);
    const nuevas = validas.map((f, i) => [ids[i], String(f.nombres).trim(), String(f.apellidos || '').trim(),
      String(f.grupo || '').trim(), String(f.seccion || '').trim(), String(f.documento || '').trim(),
      String(f.foto || '').trim(), nuevoTokenStr_(), 'Sí', hoyStr_()]);
    if (nuevas.length) agregarFilas_(sh, nuevas);
    return { ok: true, agregados: nuevas.length, omitidos: omitidos };
  } finally {
    lock.releaseLock();
  }
}

function estadoPersona_(id, activo) {
  const p = leerPersonas_().find(x => x.id === id);
  if (!p) throw new Error('No existe el registro ' + id);
  hoja_(HOJA_PERSONAS, COLS_P).getRange(p.fila, 9).setNumberFormat('@').setValue(activo === 'No' ? 'No' : 'Sí');
  return { ok: true };
}

/** Carnet perdido: genera un QR nuevo y el anterior deja de funcionar. */
function nuevoToken_(id) {
  const p = leerPersonas_().find(x => x.id === id);
  if (!p) throw new Error('No existe el registro ' + id);
  const t = nuevoTokenStr_();
  hoja_(HOJA_PERSONAS, COLS_P).getRange(p.fila, 8).setNumberFormat('@').setValue(t);
  return { ok: true, token: t };
}

/* ================= CONFIGURACIÓN ================= */

function guardarConfig_(valores) {
  const permitidas = Object.keys(CONFIG_DEFAULT).filter(k => k !== 'CARPETA_ID');
  const limpio = {};
  Object.keys(valores).forEach(k => { if (permitidas.indexOf(k) >= 0) limpio[k] = String(valores[k]).trim(); });
  CLAVES_ACCESO.forEach(k => {
    if (limpio[k] !== undefined && limpio[k].length < 4) throw new Error('Las claves deben tener al menos 4 caracteres');
  });
  const actual = leerConfig_();
  const adm = limpio.CLAVE_ADMIN || actual.CLAVE_ADMIN, esc = limpio.CLAVE_ESCANER || actual.CLAVE_ESCANER;
  if (adm === esc) throw new Error('La clave de administrador y la del escáner deben ser distintas');
  setConfig_(limpio);
  return { ok: true, config: configPublica_(leerConfig_(), 'admin') };
}

function subirLogo_(req, cfg) {
  if (!req.base64) throw new Error('No se recibió la imagen');
  const mime = req.mime || 'image/png';
  const url = guardarImagen_(req.base64, mime, 'logo.' + (mime.indexOf('png') >= 0 ? 'png' : 'jpg'), cfg, cfg.LOGO_URL);
  setConfig_({ LOGO_URL: url });
  return { ok: true, url: url };
}

function configPublica_(cfg, rol) {
  const out = {};
  Object.keys(CONFIG_DEFAULT).forEach(k => {
    if (k === 'CARPETA_ID') return;
    if (CLAVES_ACCESO.indexOf(k) >= 0 && rol !== 'admin') return;
    out[k] = cfg[k] !== undefined ? cfg[k] : CONFIG_DEFAULT[k];
  });
  return out;
}

function leerConfig_() {
  const sh = hoja_(HOJA_CONFIG, ['Clave', 'Valor']);
  const n = sh.getLastRow() - 1;
  const cfg = {};
  if (n > 0) sh.getRange(2, 1, n, 2).getDisplayValues().forEach(r => { if (r[0]) cfg[r[0]] = r[1]; });
  return cfg;
}

function setConfig_(obj) {
  const sh = hoja_(HOJA_CONFIG, ['Clave', 'Valor']);
  const n = sh.getLastRow() - 1;
  const claves = n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues().map(r => r[0]) : [];
  const nuevas = [];
  Object.keys(obj).forEach(k => {
    const i = claves.indexOf(k);
    if (i >= 0) sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(obj[k]));
    else nuevas.push([k, String(obj[k])]);
  });
  if (nuevas.length) agregarFilas_(sh, nuevas);
}

/* ================= UTILIDADES ================= */

function hoja_(nombre, encabezados) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, sh.getMaxRows(), encabezados.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados])
      .setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Escribe filas como texto plano (evita que Sheets convierta horas, fechas o códigos). */
function agregarFilas_(sh, filas) {
  const ini = sh.getLastRow() + 1;
  const falta = ini + filas.length - 1 - sh.getMaxRows();
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta + 100);
  sh.getRange(ini, 1, filas.length, filas[0].length).setNumberFormat('@')
    .setValues(filas.map(f => f.map(v => v === null || v === undefined ? '' : String(v))));
}

function filaAPersona_(f) {
  return { id: f[0], nombres: f[1], apellidos: f[2], grupo: f[3], seccion: f[4], documento: f[5], foto: f[6], token: f[7], activo: f[8], creado: f[9] };
}

function publica_(p) {
  return { id: p.id, nombre: nombreCompleto_(p), nombres: p.nombres, apellidos: p.apellidos, grupo: p.grupo, seccion: p.seccion, foto: p.foto };
}

function nombreCompleto_(p) { return (p.nombres + ' ' + (p.apellidos || '')).trim(); }

function siguienteId_(personas, cfg, cuantos) {
  const pref = cfg.TIPO_ORG === 'Empresa' ? 'E' : 'A';
  let max = 0;
  personas.forEach(p => { const m = String(p.id).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  const out = [];
  for (let i = 1; i <= cuantos; i++) out.push(pref + String(max + i).padStart(4, '0'));
  return out;
}

function nuevoTokenStr_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase(); }

function nuevaClave_(soloNumeros) {
  const abc = soloNumeros ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < (soloNumeros ? 6 : 8); i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function seg_(hhmm) {
  const p = String(hhmm || '0:0').split(':').map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

function hoyStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function carpetaFotos_(cfg) {
  if (cfg.CARPETA_ID) {
    try { return DriveApp.getFolderById(cfg.CARPETA_ID); } catch (e) {}
  }
  const f = DriveApp.createFolder('Asistencia QR - Fotos (' + SpreadsheetApp.getActive().getName() + ')');
  setConfig_({ CARPETA_ID: f.getId() });
  return f;
}

/** Guarda una imagen en Drive, la comparte por enlace y devuelve una URL que se puede usar en <img>. */
function guardarImagen_(base64, mime, nombre, cfg, urlAnterior) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, nombre);
  const file = carpetaFotos_(cfg).createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  const m = String(urlAnterior || '').match(/\/d\/([\w-]{20,})/);
  if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) {} }
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
