-- =====================================================
-- INVENTARIO_MELARA.sql  (versión lista para Railway)
-- En Railway la base de datos ya existe y se llama "railway",
-- por eso NO hay CREATE DATABASE ni USE aquí.
-- Importar con:  mysql -h HOST -P PUERTO -u root -p railway < INVENTARIO_MELARA.sql
-- =====================================================

DROP TABLE IF EXISTS permisos;
DROP TABLE IF EXISTS prestamos;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS materiales;

CREATE TABLE materiales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50),
    cantidad INT,
    estado VARCHAR(20),
    categoria VARCHAR(50) DEFAULT 'General',
    foto VARCHAR(255) NULL
);

CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) UNIQUE,
    clave VARCHAR(100),
    rol ENUM('administrador','maestro') NOT NULL,
    nombre VARCHAR(50) NULL,
    correo VARCHAR(100) NULL UNIQUE,
    password VARCHAR(255) NULL
);

CREATE TABLE prestamos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    material_id INT,
    fecha_prestamo DATETIME,
    fecha_devolucion DATETIME NULL,
    maestro VARCHAR(50),
    FOREIGN KEY (material_id) REFERENCES materiales(id)
);

CREATE TABLE permisos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    maestro VARCHAR(50),
    material_id INT,
    puede_ver BOOLEAN DEFAULT TRUE,
    puede_prestar BOOLEAN DEFAULT FALSE,
    puede_devolver BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (material_id) REFERENCES materiales(id)
);

-- Materiales (con categoría ya incluida)
INSERT INTO materiales (nombre, cantidad, estado, categoria) VALUES
('Libro de Matemáticas', 10, 'Bueno', 'Tecnología'),
('Cuaderno', 20, 'Nuevo', 'Papelería'),
('Lápiz', 50, 'Nuevo', 'Papelería'),
('Borrador', 30, 'Usado', 'Papelería'),
('Regla', 15, 'Bueno', 'Papelería'),
('Botella', 5, 'Nuevo', 'General');

-- Usuarios (contraseñas ya encriptadas con bcrypt, las mismas que tenías)
INSERT INTO usuarios (usuario, rol, nombre, password) VALUES
('admin', 'administrador', 'admin', '$2b$08$iDCfV/d61APDiaDcZYsHd.wWQ2T/FlQMr3tEtls8tasK/oGWi7Iz.'),
('juan',  'maestro',       'juan',  '$2b$08$10BZS6PWc2XugfO010vONexVq2uNbNWmOsAJYwJit/4wLwRM167XS');

-- Permisos de juan sobre todos los materiales
INSERT INTO permisos (maestro, material_id, puede_ver, puede_prestar, puede_devolver) VALUES
('juan', 1, TRUE, TRUE, TRUE),
('juan', 2, TRUE, TRUE, TRUE),
('juan', 3, TRUE, TRUE, TRUE),
('juan', 4, TRUE, TRUE, TRUE),
('juan', 5, TRUE, TRUE, TRUE),
('juan', 6, TRUE, TRUE, TRUE);
