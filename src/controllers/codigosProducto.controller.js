const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAll = async (req, res) => {
    try {
        const codigos = await prisma.codigoProducto.findMany({
            orderBy: {
                codigo: 'asc'
            }
        });
        res.status(200).json(codigos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener códigos de producto', detalle: error.message });
    }
};

const getById = async (req, res) => {
    try {
        const { id } = req.params;
        const codigo = await prisma.codigoProducto.findUnique({
            where: { id_codigo: id }
        });
        if (!codigo) return res.status(404).json({ error: 'Código de producto no encontrado' });
        res.status(200).json(codigo);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el código de producto', detalle: error.message });
    }
};

const create = async (req, res) => {
    try {
        const { codigo, descripcion } = req.body;
        
        // Verificar si existe
        const existing = await prisma.codigoProducto.findUnique({
            where: { codigo }
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Ya existe un registro con este código' });
        }

        const nuevoCodigo = await prisma.codigoProducto.create({
            data: { codigo, descripcion }
        });
        res.status(201).json(nuevoCodigo);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear código de producto', detalle: error.message });
    }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo, descripcion } = req.body;

        // Si cambia el codigo, verificar que no exista ya
        if (codigo) {
            const existing = await prisma.codigoProducto.findUnique({
                where: { codigo }
            });
            if (existing && existing.id_codigo !== id) {
                return res.status(400).json({ error: 'Ya existe un registro con este código' });
            }
        }

        const codigoActualizado = await prisma.codigoProducto.update({
            where: { id_codigo: id },
            data: { codigo, descripcion }
        });
        res.status(200).json(codigoActualizado);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar código de producto', detalle: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar dependencias
        const enUso = await prisma.producto.findFirst({
            where: { id_codigo_producto: id }
        });
        
        if (enUso) {
            return res.status(400).json({ error: 'No se puede eliminar porque hay productos usándolo' });
        }

        await prisma.codigoProducto.delete({
            where: { id_codigo: id }
        });
        res.status(200).json({ mensaje: 'Código de producto eliminado exitosamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar código de producto', detalle: error.message });
    }
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    remove
};
