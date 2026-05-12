const prisma = require('./src/config/prisma');

async function revert10Percent() {
    console.log('🔄 Revirtiendo aumento del 10% exactamente...');
    
    try {
        // Obtener todos los productos activos
        const productos = await prisma.producto.findMany({
            where: { activo: true },
            select: {
                id_producto: true,
                nombre: true,
                precio_venta_sugerido: true,
                precio_pushsport: true
            }
        });

        console.log(`📊 Encontrados ${productos.length} productos para revertir`);

        // Actualizar cada producto dividiendo por 1.10 exactamente
        for (const producto of productos) {
            const precioVentaOriginal = Number(producto.precio_venta_sugerido) / 1.10;
            const precioPushOriginal = Number(producto.precio_pushsport) / 1.10;

            await prisma.producto.update({
                where: { id_producto: producto.id_producto },
                data: {
                    precio_venta_sugerido: Math.round(precioVentaOriginal * 100) / 100,
                    precio_pushsport: Math.round(precioPushOriginal * 100) / 100
                }
            });

            console.log(`OK ${producto.nombre}: $${producto.precio_venta_sugerido} → $${Math.round(precioVentaOriginal * 100) / 100}`);
        }

        console.log('Todos los precios han sido revertidos exactamente!');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

revert10Percent();
