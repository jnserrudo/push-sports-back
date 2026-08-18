const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
const productosDir = path.join(uploadsRoot, 'productos');
fs.mkdirSync(productosDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productosDir),
    filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safeExt}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error('Formato no soportado. Usá JPG, PNG o WEBP.'), ok);
    },
});

const publicBase = () =>
    (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'https://pushsport.com.ar').replace(/\/$/, '');

router.post('/', authMiddleware, roleMiddleware([1, 2]), (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message || 'Error al subir la imagen' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No se envió ningún archivo' });
        }
        const url = `${publicBase()}/uploads/productos/${req.file.filename}`;
        return res.json({ url });
    });
});

router.delete('/', authMiddleware, roleMiddleware([1, 2]), (req, res) => {
    const url = req.body?.url || '';
    const marker = '/uploads/productos/';
    const idx = url.indexOf(marker);
    if (idx === -1) {
        return res.json({ ok: true, skipped: true });
    }
    const filename = path.basename(url.slice(idx + marker.length));
    const full = path.join(productosDir, filename);
    if (full.startsWith(productosDir) && fs.existsSync(full)) {
        fs.unlinkSync(full);
    }
    return res.json({ ok: true });
});

module.exports = router;
