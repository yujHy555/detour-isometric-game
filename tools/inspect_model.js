// Node tool to inspect .glb models placed in public/models
const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, '..', 'public', 'models');
const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.glb'));

if (files.length === 0) {
  console.log('No .glb files found in public/models/. Place character.glb or player.glb here to inspect.');
  process.exit(0);
}

files.forEach(file => {
  const filePath = path.join(modelsDir, file);
  const stats = fs.statSync(filePath);
  console.log(`\n========================================`);
  console.log(`Model: ${file} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`========================================`);

  try {
    const buffer = fs.readFileSync(filePath);
    // Parse GLB Header
    const magic = buffer.readUInt32LE(0);
    const version = buffer.readUInt32LE(4);
    const length = buffer.readUInt32LE(8);

    if (magic !== 0x46546C67) {
      console.log('Not a valid GLB container.');
      return;
    }

    // Chunk 0 (JSON)
    const chunkLength = buffer.readUInt32LE(12);
    const chunkType = buffer.readUInt32LE(16);
    if (chunkType === 0x4E4F534A) {
      const jsonStr = buffer.toString('utf8', 20, 20 + chunkLength);
      const gltf = JSON.parse(jsonStr);

      console.log(`Meshes: ${gltf.meshes ? gltf.meshes.length : 0}`);
      console.log(`Nodes: ${gltf.nodes ? gltf.nodes.length : 0}`);
      console.log(`Skins (Armatures): ${gltf.skins ? gltf.skins.length : 0}`);

      if (gltf.animations && gltf.animations.length > 0) {
        console.log(`\nAnimations (${gltf.animations.length} clips):`);
        gltf.animations.forEach((anim, i) => {
          console.log(`  [${i + 1}] "${anim.name || 'Unnamed'}" (${anim.channels ? anim.channels.length : 0} channels)`);
        });
      } else {
        console.log('\nAnimations: None found.');
      }

      if (gltf.materials && gltf.materials.length > 0) {
        console.log(`\nMaterials (${gltf.materials.length}):`);
        gltf.materials.forEach((mat, i) => {
          console.log(`  [${i + 1}] "${mat.name || 'Unnamed'}"`);
        });
      }
    }
  } catch (err) {
    console.error('Failed to parse GLB:', err.message);
  }
});
