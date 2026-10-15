// =====================================================
// SERVIDOR COMPLETO - Sistema de Inventario Escolar
// Guías 8, 10, 11, 12, 13, 14, 15, 16 y 17
// =====================================================

const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();

app.use(bodyParser.json());
app.use(cors());

const SECRET = process.env.JWT_SECRET || "clave_secreta_inventario_2024";

// ================ CARPETA QR ================
const qrsDir = path.join(__dirname, "qrs");
if (!fs.existsSync(qrsDir)) {
    fs.mkdirSync(qrsDir);
    console.log("📁 Carpeta 'qrs' creada");
}

// ================ CARPETA UPLOADS ================
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log("📁 Carpeta 'uploads' creada");
}

// ================ CONEXIÓN A MYSQL ================
// En Railway usa las variables MYSQL*. En local usa XAMPP/MariaDB como antes.
// Se usa un POOL (no una conexión única) para que no se caiga por inactividad.
const conexion = mysql.createPool({
    host: process.env.MYSQLHOST || "localhost",
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "1234",
    database: process.env.MYSQLDATABASE || "inventario_db",
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true
});

conexion.getConnection((err, con) => {
    if (err) {
        console.error("❌ Error conectando a MySQL:", err.message);
        return;
    }
    console.log("✅ Conectado a MySQL");
    con.release();
});

// ================ MULTER (CORREGIDO) ================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        const nombreArchivo = `material_${Date.now()}${ext}`;
        cb(null, nombreArchivo);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        // Validación TOLERANTE: acepta mimetypes válidos, vacíos, o extensiones conocidas
        const extensionesValidas = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        const ext = path.extname(file.originalname || '').toLowerCase();
        
        const esImagen = 
            (file.mimetype && file.mimetype.startsWith('image/')) ||
            !file.mimetype ||
            file.mimetype === 'application/octet-stream' ||
            extensionesValidas.includes(ext);
        
        if (esImagen) {
            cb(null, true);
        } else {
            console.log("❌ Archivo rechazado:", {
                originalname: file.originalname,
                mimetype: file.mimetype
            });
            // Importante: cb(null, false) en lugar de cb(new Error(...))
            // Así multer ignora el archivo SIN lanzar un error 500 (que devuelve HTML)
            cb(null, false);
        }
    }
});

// Servir archivos estáticos
app.use('/uploads', express.static(uploadsDir));

// =====================================================
// MIDDLEWARE DE MANEJO DE ERRORES (para que multer devuelva JSON)
// =====================================================
app.use((err, req, res, next) => {
    console.error("❌ Error no capturado:", err.message);
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ 
            status: "error", 
            mensaje: `Error al subir archivo: ${err.message}` 
        });
    }
    
    if (err) {
        return res.status(500).json({ 
            status: "error", 
            mensaje: err.message 
        });
    }
    
    next();
});

// =====================================================
// ENDPOINTS QR (GUÍA 11)
// =====================================================

app.post("/generar-qr", (req, res) => {
    const { material_id, nombre } = req.body;

    if (!material_id || !nombre) {
        return res.json({
            status: "error",
            mensaje: "Faltan datos: material_id y nombre son requeridos"
        });
    }

    const qrContent = String(material_id);
    const ruta = path.join(qrsDir, `${material_id}.png`);

    QRCode.toFile(ruta, qrContent, {
        color: { dark: '#000000', light: '#FFFFFF' },
        margin: 2,
        width: 300
    }, function (err) {
        if (err) {
            console.error("Error generando QR:", err);
            return res.json({
                status: "error",
                mensaje: "Error al generar QR: " + err.message
            });
        }
        console.log(`✅ QR generado: ${ruta}`);
        res.json({
            status: "ok",
            mensaje: `QR generado para '${nombre}' (ID: ${material_id})`,
            ruta: `/qrs/${material_id}.png`
        });
    });
});

app.get("/qrs/:material_id.png", (req, res) => {
    const ruta = path.join(qrsDir, `${req.params.material_id}.png`);
    if (fs.existsSync(ruta)) {
        res.sendFile(ruta);
    } else {
        res.status(404).json({ status: "error", mensaje: "QR no encontrado" });
    }
});

// =====================================================
// ENDPOINTS PRINCIPALES
// =====================================================

app.get("/", (req, res) => {
    res.send("Bienvenido a Inventario API");
});

// =====================================================
// MATERIALES (GUÍA 16)
// =====================================================

app.get("/materiales", (req, res) => {
    const sql = "SELECT * FROM materiales";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

app.post("/materiales", upload.single("foto"), (req, res) => {
    const { nombre, cantidad, estado, categoria } = req.body;
    const foto = req.file ? `uploads/${req.file.filename}` : null;

    if (!nombre || !nombre.trim()) {
        return res.json({ status: "error", mensaje: "El nombre es obligatorio" });
    }

    const sql = "INSERT INTO materiales (nombre, cantidad, estado, categoria, foto) VALUES (?, ?, ?, ?, ?)";
    conexion.query(
        sql,
        [nombre, cantidad || 0, estado || 'Nuevo', categoria || 'General', foto],
        (err, result) => {
            if (err) {
                console.error("Error al registrar material:", err);
                res.json({ status: "error", mensaje: err.message });
            } else {
                res.json({
                    status: "ok",
                    mensaje: "Material registrado correctamente",
                    id: result.insertId
                });
            }
        }
    );
});

app.put("/materiales/:id", upload.single("foto"), (req, res) => {
    const { id } = req.params;
    const { nombre, cantidad, estado, categoria } = req.body;

    console.log("=== PUT /materiales/" + id + " ===");
    console.log("Body:", req.body);
    console.log("File:", req.file ? req.file.filename : "sin archivo");

    if (req.file) {
        const foto = `uploads/${req.file.filename}`;
        const sql = "UPDATE materiales SET nombre = ?, cantidad = ?, estado = ?, categoria = ?, foto = ? WHERE id = ?";
        conexion.query(sql, [nombre, cantidad, estado, categoria, foto, id], (err) => {
            if (err) {
                console.error("Error en UPDATE:", err);
                res.json({ status: "error", mensaje: err.message });
            } else {
                res.json({ status: "ok", mensaje: "Material actualizado con nueva foto" });
            }
        });
    } else {
        const sql = "UPDATE materiales SET nombre = ?, cantidad = ?, estado = ?, categoria = ? WHERE id = ?";
        conexion.query(sql, [nombre, cantidad, estado, categoria, id], (err) => {
            if (err) {
                console.error("Error en UPDATE:", err);
                res.json({ status: "error", mensaje: err.message });
            } else {
                res.json({ status: "ok", mensaje: "Material actualizado" });
            }
        });
    }
});

app.delete("/materiales/:id", (req, res) => {
    const { id } = req.params;

    const sqlGet = "SELECT foto FROM materiales WHERE id = ?";
    conexion.query(sqlGet, [id], (errGet, resultGet) => {
        if (errGet) return res.json({ status: "error", mensaje: errGet });

        const foto = resultGet[0]?.foto;
        if (foto) {
            const rutaFoto = path.join(__dirname, foto);
            if (fs.existsSync(rutaFoto)) {
                fs.unlinkSync(rutaFoto);
            }
        }

        const sqlDelete = "DELETE FROM materiales WHERE id = ?";
        conexion.query(sqlDelete, [id], (errDel) => {
            if (errDel) {
                if (errDel.code === 'ER_ROW_IS_REFERENCED_2') {
                    return res.json({
                        status: "error",
                        mensaje: "No se puede eliminar: el material tiene préstamos o permisos asociados"
                    });
                }
                return res.json({ status: "error", mensaje: errDel.message });
            }
            res.json({ status: "ok", mensaje: "Material eliminado correctamente" });
        });
    });
});

// =====================================================
// USUARIOS (GUÍA 15)
// =====================================================

app.get("/usuarios/maestros", (req, res) => {
    const sql = "SELECT id, usuario, nombre, correo FROM usuarios WHERE rol = 'maestro'";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

app.get("/usuarios", (req, res) => {
    const sql = "SELECT id, usuario, nombre, correo, rol FROM usuarios";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

// =====================================================
// AUTENTICACIÓN CON JWT (GUÍA 13)
// =====================================================

app.post("/login", (req, res) => {
    const { usuario, clave, correo, password } = req.body;

    const loginUser = usuario || correo;
    const loginPass = clave || password;

    if (!loginUser || !loginPass) {
        return res.json({
            status: "fail",
            mensaje: "Usuario y contraseña son requeridos"
        });
    }

    const sql = "SELECT * FROM usuarios WHERE usuario = ? OR correo = ?";
    conexion.query(sql, [loginUser, loginUser], (err, result) => {
        if (err) return res.json({ status: "error", mensaje: err });
        if (result.length === 0) {
            return res.json({ status: "fail", mensaje: "Credenciales incorrectas" });
        }

        const user = result[0];
        let passwordValido = false;

        if (user.password && user.password.startsWith('$2')) {
            passwordValido = bcrypt.compareSync(loginPass, user.password);
        } else if (user.clave) {
            passwordValido = (user.clave === loginPass);
        }

        if (!passwordValido) {
            return res.json({ status: "fail", mensaje: "Credenciales incorrectas" });
        }

        const token = jwt.sign(
            { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
            SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            status: "ok",
            token: token,
            rol: user.rol,
            nombre: user.nombre || user.usuario,
            usuario: user.usuario
        });
    });
});

app.post("/registro", (req, res) => {
    const { usuario, nombre, correo, password, clave, rol } = req.body;

    const passFinal = password || clave;

    if (!usuario || !passFinal) {
        return res.json({
            status: "error",
            mensaje: "Usuario y contraseña son requeridos"
        });
    }

    const hashedPassword = bcrypt.hashSync(passFinal, 8);

    const sql = "INSERT INTO usuarios (usuario, nombre, correo, password, rol) VALUES (?, ?, ?, ?, ?)";
    conexion.query(
        sql,
        [usuario, nombre || usuario, correo || null, hashedPassword, rol || 'maestro'],
        (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.json({
                        status: "error",
                        mensaje: "El usuario o correo ya existe"
                    });
                }
                return res.json({ status: "error", mensaje: err.message });
            }
            res.json({
                status: "ok",
                mensaje: "Usuario registrado exitosamente",
                id: result.insertId
            });
        }
    );
});

function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
        return res.status(401).json({ status: "error", mensaje: "Token requerido" });
    }

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ status: "error", mensaje: "Token inválido o expirado" });
        }
        req.usuario = decoded;
        next();
    });
}

function soloAdmin(req, res, next) {
    if (req.usuario.rol !== 'administrador' && req.usuario.rol !== 'admin') {
        return res.status(403).json({
            status: "error",
            mensaje: "Acceso denegado: se requiere rol de administrador"
        });
    }
    next();
}

app.get("/admin/reportes", verificarToken, soloAdmin, (req, res) => {
    res.json({
        status: "ok",
        mensaje: `Bienvenido administrador ${req.usuario.nombre || req.usuario.usuario}`
    });
});

app.get("/perfil", verificarToken, (req, res) => {
    res.json({ status: "ok", usuario: req.usuario });
});

// =====================================================
// PRÉSTAMOS
// =====================================================

app.post("/prestamos", (req, res) => {
    const { material_id, fecha_prestamo, maestro } = req.body;

    const sqlPermiso = "SELECT * FROM permisos WHERE maestro = ? AND material_id = ? AND puede_prestar = TRUE";
    conexion.query(sqlPermiso, [maestro, material_id], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else if (result.length === 0) {
            res.json({ status: "fail", mensaje: "No tienes permiso para prestar este material" });
        } else {
            const sql = "INSERT INTO prestamos (material_id, fecha_prestamo, maestro) VALUES (?, ?, ?)";
            conexion.query(sql, [material_id, fecha_prestamo, maestro], (err2) => {
                if (err2) res.json({ status: "error", mensaje: err2 });
                else res.json({ status: "ok", mensaje: "Préstamo registrado" });
            });
        }
    });
});

app.get("/prestamos", (req, res) => {
    const sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            p.fecha_prestamo,
            p.fecha_devolucion,
            p.maestro,
            COALESCE(u.nombre, p.maestro) AS docente
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        LEFT JOIN usuarios u ON u.usuario = p.maestro
        ORDER BY p.id DESC
    `;
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

app.put("/prestamos/devolver/:material_id", (req, res) => {
    const materialId = req.params.material_id;
    const sqlBuscar = "SELECT id FROM prestamos WHERE material_id = ? AND fecha_devolucion IS NULL ORDER BY id DESC LIMIT 1";
    conexion.query(sqlBuscar, [materialId], (errBuscar, resultBuscar) => {
        if (errBuscar) return res.json({ status: "error", mensaje: errBuscar });

        if (resultBuscar.length === 0) {
            return res.json({ status: "fail", mensaje: "No hay préstamos pendientes para este material" });
        }

        const prestamoId = resultBuscar[0].id;
        const sql = "UPDATE prestamos SET fecha_devolucion = NOW() WHERE id = ?";
        conexion.query(sql, [prestamoId], (err) => {
            if (err) res.json({ status: "error", mensaje: err });
            else res.json({ status: "ok", mensaje: "Entrega registrada" });
        });
    });
});

app.put("/prestamos/devolver/id/:id", (req, res) => {
    const sql = "UPDATE prestamos SET fecha_devolucion = NOW() WHERE id = ?";
    conexion.query(sql, [req.params.id], (err) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json({ status: "ok", mensaje: "Material devuelto" });
    });
});

app.put("/prestamos/:id", (req, res) => {
    const { fecha_devolucion } = req.body;
    const sql = "UPDATE prestamos SET fecha_devolucion = ? WHERE id = ?";
    conexion.query(sql, [fecha_devolucion, req.params.id], (err) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json({ status: "ok", mensaje: "Préstamo actualizado" });
    });
});

// =====================================================
// HISTORIAL DE PRÉSTAMOS (GUÍA 17)
// =====================================================

app.get("/historial", (req, res) => {
    const { maestro, material, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            COALESCE(u.nombre, p.maestro) AS docente,
            p.maestro AS usuario_maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion,
            CASE 
                WHEN p.fecha_devolucion IS NULL THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        LEFT JOIN usuarios u ON u.usuario = p.maestro
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND (u.nombre LIKE ? OR p.maestro LIKE ?)";
        params.push(`%${maestro.trim()}%`);
        params.push(`%${maestro.trim()}%`);
    }
    if (material && material.trim() !== "") {
        sql += " AND m.nombre LIKE ?";
        params.push(`%${material.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }

    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, (err, result) => {
        if (err) {
            console.error("Error en historial:", err);
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

app.get("/historial/pdf", (req, res) => {
    const { maestro, material, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            COALESCE(u.nombre, p.maestro) AS docente,
            p.maestro AS usuario_maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion,
            CASE 
                WHEN p.fecha_devolucion IS NULL THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        LEFT JOIN usuarios u ON u.usuario = p.maestro
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND (u.nombre LIKE ? OR p.maestro LIKE ?)";
        params.push(`%${maestro.trim()}%`);
        params.push(`%${maestro.trim()}%`);
    }
    if (material && material.trim() !== "") {
        sql += " AND m.nombre LIKE ?";
        params.push(`%${material.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }
    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ status: "error", mensaje: err });

        const doc = new PDFDocument({ margin: 40, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=historial_prestamos.pdf');

        doc.pipe(res);

        doc.fontSize(20).fillColor('#2563EB').text('Historial de Préstamos', { align: 'center' });
        doc.moveDown(0.5);

        doc.fontSize(10).fillColor('#666666');
        if (maestro && maestro.trim() !== "") doc.text(`Maestro: ${maestro}`);
        if (material && material.trim() !== "") doc.text(`Material: ${material}`);
        if (fecha_inicio && fecha_inicio.trim() !== "") doc.text(`Desde: ${fecha_inicio}`);
        if (fecha_fin && fecha_fin.trim() !== "") doc.text(`Hasta: ${fecha_fin}`);
        doc.text(`Generado: ${new Date().toLocaleString()}`);
        doc.moveDown(1);

        const tableTop = doc.y;
        const colWidths = [30, 145, 115, 75, 75, 70];
        const headers = ['ID', 'Material', 'Docente', 'Préstamo', 'Devolución', 'Estado'];
        let xPos = 40;

        doc.fontSize(9).fillColor('#FFFFFF');
        doc.rect(40, tableTop, 510, 20).fill('#2563EB');

        headers.forEach((header, i) => {
            doc.fillColor('#FFFFFF').text(header, xPos + 4, tableTop + 6, {
                width: colWidths[i] - 8,
                align: 'left'
            });
            xPos += colWidths[i];
        });

        let yPos = tableTop + 25;
        doc.fontSize(8);

        result.forEach((row, index) => {
            if (yPos > 750) {
                doc.addPage();
                yPos = 40;
            }
            if (index % 2 === 0) {
                doc.rect(40, yPos - 3, 510, 18).fill('#F3F4F6');
            }

            xPos = 40;
            const values = [
                String(row.id),
                row.material || 'N/A',
                row.docente || 'N/A',
                row.fecha_prestamo || 'N/A',
                row.fecha_devolucion || 'Pendiente',
                row.estado || 'N/A'
            ];

            values.forEach((value, i) => {
                let color = '#000000';
                if (i === 5) {
                    if (value === 'Pendiente') color = '#FF6B00';
                    else if (value === 'Devuelto') color = '#16A34A';
                }
                doc.fillColor(color).text(value, xPos + 4, yPos, {
                    width: colWidths[i] - 8,
                    align: 'left'
                });
                xPos += colWidths[i];
            });

            yPos += 18;
        });

        doc.moveDown(2);
        doc.fontSize(11).fillColor('#2563EB')
            .text(`Total de registros: ${result.length}`, { align: 'right' });

        const pendientes = result.filter(r => r.estado === 'Pendiente').length;
        const devueltos = result.filter(r => r.estado === 'Devuelto').length;

        doc.moveDown(1);
        doc.fontSize(9).fillColor('#666666')
            .text(`Pendientes: ${pendientes}  |  Devueltos: ${devueltos}`, { align: 'right' });

        doc.end();
    });
});

app.get("/historial/excel", (req, res) => {
    const { maestro, material, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            COALESCE(u.nombre, p.maestro) AS docente,
            p.maestro AS usuario_maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion,
            CASE 
                WHEN p.fecha_devolucion IS NULL THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        LEFT JOIN usuarios u ON u.usuario = p.maestro
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND (u.nombre LIKE ? OR p.maestro LIKE ?)";
        params.push(`%${maestro.trim()}%`);
        params.push(`%${maestro.trim()}%`);
    }
    if (material && material.trim() !== "") {
        sql += " AND m.nombre LIKE ?";
        params.push(`%${material.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }
    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, async (err, result) => {
        if (err) return res.status(500).json({ status: "error", mensaje: err });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema de Inventario';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Historial');

        worksheet.mergeCells('A1:F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'Historial de Préstamos';
        titleCell.font = { size: 16, bold: true, color: { argb: 'FF2563EB' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        let filterRow = 2;
        if (maestro && maestro.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Maestro: ${maestro}`;
            filterRow++;
        }
        if (material && material.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Material: ${material}`;
            filterRow++;
        }
        if (fecha_inicio && fecha_inicio.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Desde: ${fecha_inicio}`;
            filterRow++;
        }
        if (fecha_fin && fecha_fin.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Hasta: ${fecha_fin}`;
            filterRow++;
        }
        worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
        worksheet.getCell(`A${filterRow}`).value = `Generado: ${new Date().toLocaleString()}`;
        filterRow += 2;

        const headerRow = worksheet.getRow(filterRow);
        headerRow.values = ['ID', 'Material', 'Docente', 'Fecha Préstamo', 'Fecha Devolución', 'Estado'];
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 20;

        worksheet.columns = [
            { key: 'id', width: 8 },
            { key: 'material', width: 30 },
            { key: 'docente', width: 25 },
            { key: 'fecha_prestamo', width: 18 },
            { key: 'fecha_devolucion', width: 18 },
            { key: 'estado', width: 15 },
        ];

        result.forEach((row, index) => {
            const dataRow = worksheet.addRow([
                row.id,
                row.material || 'N/A',
                row.docente || 'N/A',
                row.fecha_prestamo || 'N/A',
                row.fecha_devolucion || 'Pendiente',
                row.estado
            ]);

            if (index % 2 === 0) {
                dataRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF3F4F6' }
                };
            }

            if (row.estado === 'Pendiente') {
                dataRow.getCell(6).font = { color: { argb: 'FFFF6B00' }, bold: true };
            } else {
                dataRow.getCell(6).font = { color: { argb: 'FF16A34A' }, bold: true };
            }
        });

        const totalRow = worksheet.addRow([]);
        totalRow.getCell(1).value = `Total: ${result.length}`;
        totalRow.font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=historial_prestamos.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    });
});

// =====================================================
// PERMISOS (GUÍA 10)
// =====================================================

app.post("/permisos", (req, res) => {
    const { maestro, material_id, puede_ver, puede_prestar, puede_devolver } = req.body;

    const sqlCheck = "SELECT * FROM permisos WHERE maestro = ? AND material_id = ?";
    conexion.query(sqlCheck, [maestro, material_id], (errCheck, resultCheck) => {
        if (errCheck) return res.json({ status: "error", mensaje: errCheck });

        if (resultCheck.length > 0) {
            const sqlUpdate = "UPDATE permisos SET puede_ver = ?, puede_prestar = ?, puede_devolver = ? WHERE maestro = ? AND material_id = ?";
            conexion.query(sqlUpdate, [puede_ver, puede_prestar, puede_devolver, maestro, material_id], (errUpdate) => {
                if (errUpdate) res.json({ status: "error", mensaje: errUpdate });
                else res.json({ status: "ok", mensaje: "Permiso actualizado correctamente" });
            });
        } else {
            const sqlInsert = "INSERT INTO permisos (maestro, material_id, puede_ver, puede_prestar, puede_devolver) VALUES (?, ?, ?, ?, ?)";
            conexion.query(sqlInsert, [maestro, material_id, puede_ver, puede_prestar, puede_devolver], (errInsert) => {
                if (errInsert) res.json({ status: "error", mensaje: errInsert });
                else res.json({ status: "ok", mensaje: "Permiso asignado correctamente" });
            });
        }
    });
});

app.get("/permisos", (req, res) => {
    const sql = "SELECT * FROM permisos";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

app.get("/permisos/:maestro", (req, res) => {
    const sql = "SELECT * FROM permisos WHERE maestro = ?";
    conexion.query(sql, [req.params.maestro], (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

// =====================================================
// REPORTES BÁSICOS
// =====================================================

app.get("/reportes/total", (req, res) => {
    const sql = "SELECT COUNT(*) AS total FROM prestamos";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/pendientes", (req, res) => {
    const sql = "SELECT COUNT(*) AS pendientes FROM prestamos WHERE fecha_devolucion IS NULL";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/devueltos", (req, res) => {
    const sql = "SELECT COUNT(*) AS devueltos FROM prestamos WHERE fecha_devolucion IS NOT NULL";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

// =====================================================
// REPORTES FILTRADOS (GUÍA 12)
// =====================================================

app.get("/reportes/filtrados", (req, res) => {
    const { maestro, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            p.maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND p.maestro LIKE ?";
        params.push(`%${maestro.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }
    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

// =====================================================
// EXPORTAR PDF (GUÍA 12)
// =====================================================

app.get("/reportes/pdf", (req, res) => {
    const { maestro, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            p.maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion,
            CASE 
                WHEN p.fecha_devolucion IS NULL THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND p.maestro LIKE ?";
        params.push(`%${maestro.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }
    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ status: "error", mensaje: err });

        const doc = new PDFDocument({ margin: 40, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte_prestamos.pdf');

        doc.pipe(res);

        doc.fontSize(20).fillColor('#2563EB').text('Reporte de Préstamos', { align: 'center' });
        doc.moveDown(0.5);

        doc.fontSize(10).fillColor('#666666');
        if (maestro && maestro.trim() !== "") doc.text(`Maestro: ${maestro}`);
        if (fecha_inicio && fecha_inicio.trim() !== "") doc.text(`Desde: ${fecha_inicio}`);
        if (fecha_fin && fecha_fin.trim() !== "") doc.text(`Hasta: ${fecha_fin}`);
        doc.text(`Generado: ${new Date().toLocaleString()}`);
        doc.moveDown(1);

        const tableTop = doc.y;
        const colWidths = [35, 160, 85, 80, 80, 75];
        const headers = ['ID', 'Material', 'Maestro', 'Préstamo', 'Devolución', 'Estado'];
        let xPos = 40;

        doc.fontSize(10).fillColor('#FFFFFF');
        doc.rect(40, tableTop, 515, 20).fill('#2563EB');

        headers.forEach((header, i) => {
            doc.fillColor('#FFFFFF').text(header, xPos + 5, tableTop + 5, {
                width: colWidths[i] - 10,
                align: 'left'
            });
            xPos += colWidths[i];
        });

        let yPos = tableTop + 25;
        doc.fontSize(9);

        result.forEach((row, index) => {
            if (yPos > 750) {
                doc.addPage();
                yPos = 40;
            }
            if (index % 2 === 0) {
                doc.rect(40, yPos - 3, 515, 18).fill('#F3F4F6');
            }

            xPos = 40;
            const values = [
                String(row.id),
                row.material || 'N/A',
                row.maestro || 'N/A',
                row.fecha_prestamo || 'N/A',
                row.fecha_devolucion || 'Pendiente',
                row.estado || 'N/A'
            ];

            values.forEach((value, i) => {
                let color = '#000000';
                if (i === 5) {
                    if (value === 'Pendiente') color = '#FF6B00';
                    else if (value === 'Devuelto') color = '#16A34A';
                }
                doc.fillColor(color).text(value, xPos + 5, yPos, {
                    width: colWidths[i] - 10,
                    align: 'left'
                });
                xPos += colWidths[i];
            });

            yPos += 18;
        });

        doc.moveDown(2);
        doc.fontSize(11).fillColor('#2563EB')
            .text(`Total de registros: ${result.length}`, { align: 'right' });

        const pendientes = result.filter(r => r.estado === 'Pendiente').length;
        const devueltos = result.filter(r => r.estado === 'Devuelto').length;

        doc.moveDown(1);
        doc.fontSize(9).fillColor('#666666')
            .text(`Pendientes: ${pendientes}  |  Devueltos: ${devueltos}`, { align: 'right' });

        doc.end();
    });
});

// =====================================================
// EXPORTAR EXCEL (GUÍA 12)
// =====================================================

app.get("/reportes/excel", (req, res) => {
    const { maestro, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            COALESCE(m.nombre, 'Material no encontrado') AS material,
            p.maestro,
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo,
            DATE_FORMAT(p.fecha_devolucion, '%Y-%m-%d') AS fecha_devolucion,
            CASE 
                WHEN p.fecha_devolucion IS NULL THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        WHERE 1=1
    `;

    const params = [];

    if (maestro && maestro.trim() !== "") {
        sql += " AND p.maestro LIKE ?";
        params.push(`%${maestro.trim()}%`);
    }
    if (fecha_inicio && fecha_inicio.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        params.push(fecha_inicio);
    }
    if (fecha_fin && fecha_fin.trim() !== "") {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        params.push(fecha_fin);
    }
    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, async (err, result) => {
        if (err) return res.status(500).json({ status: "error", mensaje: err });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema de Inventario';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Préstamos');

        worksheet.mergeCells('A1:F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'Reporte de Préstamos';
        titleCell.font = { size: 16, bold: true, color: { argb: 'FF2563EB' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        let filterRow = 2;
        if (maestro && maestro.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Maestro: ${maestro}`;
            filterRow++;
        }
        if (fecha_inicio && fecha_inicio.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Desde: ${fecha_inicio}`;
            filterRow++;
        }
        if (fecha_fin && fecha_fin.trim() !== "") {
            worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
            worksheet.getCell(`A${filterRow}`).value = `Hasta: ${fecha_fin}`;
            filterRow++;
        }
        worksheet.mergeCells(`A${filterRow}:F${filterRow}`);
        worksheet.getCell(`A${filterRow}`).value = `Generado: ${new Date().toLocaleString()}`;
        filterRow += 2;

        const headerRow = worksheet.getRow(filterRow);
        headerRow.values = ['ID', 'Material', 'Maestro', 'Fecha Préstamo', 'Fecha Devolución', 'Estado'];
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 20;

        worksheet.columns = [
            { key: 'id', width: 8 },
            { key: 'material', width: 30 },
            { key: 'maestro', width: 20 },
            { key: 'fecha_prestamo', width: 18 },
            { key: 'fecha_devolucion', width: 18 },
            { key: 'estado', width: 15 },
        ];

        result.forEach((row, index) => {
            const dataRow = worksheet.addRow([
                row.id,
                row.material || 'N/A',
                row.maestro || 'N/A',
                row.fecha_prestamo || 'N/A',
                row.fecha_devolucion || 'Pendiente',
                row.estado
            ]);

            if (index % 2 === 0) {
                dataRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF3F4F6' }
                };
            }

            if (row.estado === 'Pendiente') {
                dataRow.getCell(6).font = { color: { argb: 'FFFF6B00' }, bold: true };
            } else {
                dataRow.getCell(6).font = { color: { argb: 'FF16A34A' }, bold: true };
            }
        });

        const totalRow = worksheet.addRow([]);
        totalRow.getCell(1).value = `Total: ${result.length}`;
        totalRow.font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte_prestamos.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    });
});

// =====================================================
// DASHBOARD - MÉTRICAS (GUÍA 14)
// =====================================================

app.get("/dashboard", (req, res) => {
    const sql = `
        SELECT 
            (SELECT COUNT(*) FROM materiales) AS total_materiales,
            (SELECT COALESCE(SUM(cantidad), 0) FROM materiales) AS total_unidades,
            (SELECT COUNT(*) FROM prestamos WHERE fecha_devolucion IS NULL) AS prestados,
            (SELECT COUNT(*) FROM prestamos WHERE fecha_devolucion IS NOT NULL) AS devueltos,
            (SELECT COUNT(*) FROM materiales WHERE LOWER(estado) LIKE '%da%') AS danados,
            (SELECT COUNT(*) FROM usuarios WHERE rol = 'maestro') AS total_maestros,
            (SELECT COUNT(*) FROM permisos) AS total_permisos
    `;
    conexion.query(sql, (err, result) => {
        if (err) {
            console.error("Error en dashboard:", err);
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result[0]);
        }
    });
});

app.get("/dashboard/prestamos-por-maestro", (req, res) => {
    const sql = `
        SELECT 
            maestro,
            COUNT(*) AS total,
            SUM(CASE WHEN fecha_devolucion IS NULL THEN 1 ELSE 0 END) AS pendientes,
            SUM(CASE WHEN fecha_devolucion IS NOT NULL THEN 1 ELSE 0 END) AS devueltos
        FROM prestamos
        GROUP BY maestro
        ORDER BY total DESC
    `;
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

app.get("/dashboard/materiales-por-estado", (req, res) => {
    const sql = `
        SELECT 
            estado,
            COUNT(*) AS total,
            SUM(cantidad) AS unidades
        FROM materiales
        GROUP BY estado
    `;
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

// =====================================================
// NOTIFICACIONES
// =====================================================

app.get("/notificaciones/:maestro", (req, res) => {
    const maestroParam = req.params.maestro.trim();

    const sql = `
        SELECT 
            p.id, 
            p.material_id, 
            DATE_FORMAT(p.fecha_prestamo, '%Y-%m-%d') AS fecha_prestamo, 
            p.maestro, 
            COALESCE(m.nombre, CONCAT('Material #', p.material_id)) AS material
        FROM prestamos p
        LEFT JOIN materiales m ON p.material_id = m.id
        WHERE TRIM(p.maestro) = ? AND p.fecha_devolucion IS NULL
        ORDER BY p.fecha_prestamo DESC
    `;

    conexion.query(sql, [maestroParam], (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result);
    });
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

const PORT = process.env.PORT || 3007;
app.listen(PORT, "0.0.0.0", () => {
    console.log("===========================================");
    console.log("🚀 Servidor escuchando en el puerto " + PORT);
    console.log("📁 Carpeta QR: " + qrsDir);
    console.log("📁 Carpeta Uploads: " + uploadsDir);
    console.log("===========================================");
});
