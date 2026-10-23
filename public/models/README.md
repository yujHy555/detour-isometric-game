# 3D Models Directory

Drop your 3D character `.glb` file here:
- **`character.glb`** or **`player.glb`**

### Features Supported:
- **Embedded Armature Rig**: Skeletal hierarchy with skinned meshes.
- **Single Baked Texture Map**: Albedo / Diffuse map baked into materials.
- **Normal Map**: Tangent space normal map.
- **ORM Map**: (Optional) Combined Occlusion, Roughness, Metallic.
- **Embedded Animations**: NLA clips named:
  - `idle`
  - `walk`
  - `run`
  - `jump` (or `jump_start`, `jump_air`, `jump_land`)
  - `death`

The game engine will detect the file automatically upon refresh and transition from the placeholder rig to your custom animated character!
