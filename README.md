# 3DMaker

A Blender-style, in-browser 3D asset creator for **game objects** and **VFX**. Built on three.js, with no build step.

## Run
```
npm start        # then open http://localhost:8080
```
(any static server works; three.js is vendored in `vendor/`)

## Features
- **Meshes**: cube, sphere, cylinder, cone, torus, torus-knot, plane, gem, capsule, each with live parametric geometry
- **Modifiers**: noise displacement, twist, taper; **PBR materials** (color, metal, rough, emissive glow, opacity, wire, flat)
- **VFX particle emitters**: Fire, Smoke, Sparks, Explosion, Magic, Heal, Snow presets, or fully custom (shape, cone, gravity, drag, turbulence, size/colour/alpha over life, additive glow, sprites, burst/loop)
- **Lights** (point/sun with shadows), move/rotate/scale gizmo, snapping, outliner, preview spin/bob animation
- **Undo/redo**, autosave, project save/open (`.3dmaker.json`)
- **Export**: glTF `.glb`, `.obj`, VFX data `.json`, PNG screenshot

## Keys
G/R/S gizmo · F focus · Space play/pause · Shift+R restart VFX · Shift+D duplicate · Del delete · Ctrl+Z / Ctrl+Shift+Z
