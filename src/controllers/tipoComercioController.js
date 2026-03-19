const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getTiposComercio = async (req, res) => {
    try {
        const tipos = await prisma.tipoComercio.findMany({
            orderBy: { nombre: 'asc' }
        });
        res.json(tipos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener tipos de comercio' });
    }
};

exports.getTipoComercioById = async (req, res) => {
    try {
        const { id } = req.params;
        const tipo = await prisma.tipoComercio.findUnique({
            where: { id_tipo_comercio: parseInt(id) }
        });
        if (!tipo) return res.status(404).json({ error: 'Tipo no encontrado' });
        res.json(tipo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el tipo de comercio' });
    }
};

exports.createTipoComercio = async (req, res) => {
    try {
        const { nombre, descripcion } = req.body;
        const newTipo = await prisma.tipoComercio.create({
            data: { nombre, descripcion }
        });
        res.status(201).json(newTipo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el tipo de comercio' });
    }
};

exports.updateTipoComercio = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion } = req.body;
        const updated = await prisma.tipoComercio.update({
            where: { id_tipo_comercio: parseInt(id) },
            data: { nombre, descripcion }
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el tipo de comercio' });
    }
};

exports.deleteTipoComercio = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verifica si hay comercios usándolo
        const comercios = await prisma.comercio.findFirst({
            where: { id_tipo_comercio: parseInt(id) }
        });

        if (comercios) {
            return res.status(400).json({ error: 'No se puede eliminar porque hay sucursales asociadas a este tipo' });
        }

        await prisma.tipoComercio.delete({
            where: { id_tipo_comercio: parseInt(id) }
        });
        res.json({ message: 'Tipo de comercio eliminado' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el tipo de comercio' });
    }
};
