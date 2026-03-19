const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const BUCKET = process.env.VITE_SUPABASE_BUCKET || 'productos';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env');
    process.exit(1);
}

const imagesDir = path.join(__dirname, '../../push_sport_reporte/public/productos_push_sports');
const outputMapFile = path.join(__dirname, 'supabase_image_map.json');

async function uploadImage(filePath, relativePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    
    // Path inside bucket: productos/v1/something.jpg (maintaining structure if possible or flat)
    // We'll use the relative path as the storage path to avoid collisions
    const storagePath = `productos/${relativePath.replace(/\\/g, '/')}`;

    const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                'x-upsert': 'true'
            },
            body: fileBuffer,
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403 || (err.message && err.message.includes('row-level security'))) {
            throw new Error(`PERMISO DENEGADO (403): La política RLS de Supabase impide la subida. 
            SOLUCIÓN: 
            1. En Supabase > Storage > Buckets > "${BUCKET}" > Policies, crea una política que permita "INSERT" para el rol "anon".
            2. O usa la "service_role" key en lugar de la "anon" key en el .env.`);
        }
        throw new Error(`Upload failed for ${storagePath}: ${res.status} - ${JSON.stringify(err)}`);
    }

    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function walkDir(dir) {
    let files = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            files = files.concat(await walkDir(fullPath));
        } else {
            if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(path.extname(file).toLowerCase())) {
                files.push(fullPath);
            }
        }
    }
    return files;
}

async function start() {
    console.log('--- Supabase Image Migration ---');
    console.log(`Scanning: ${imagesDir}`);

    if (!fs.existsSync(imagesDir)) {
        console.error(`Directory not found: ${imagesDir}`);
        return;
    }

    const allFiles = await walkDir(imagesDir);
    console.log(`Found ${allFiles.length} images to process.`);

    const imageMap = {};

    for (const file of allFiles) {
        const relativePath = path.relative(imagesDir, file);
        try {
            console.log(`Uploading: ${relativePath}...`);
            const publicUrl = await uploadImage(file, relativePath);
            // The mapping will be something like "v1/ALIMENTOS/..." -> Supabase URL
            imageMap[relativePath.replace(/\\/g, '/')] = publicUrl;
        } catch (err) {
            console.error(`Error uploading ${relativePath}:`, err.message);
        }
    }

    fs.writeFileSync(outputMapFile, JSON.stringify(imageMap, null, 2));
    console.log('--- Migration Finished ---');
    console.log(`Map saved to: ${outputMapFile}`);
    console.log('You can now run the seeder.');
}

start();
