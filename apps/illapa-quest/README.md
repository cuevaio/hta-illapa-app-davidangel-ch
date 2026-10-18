# Illapa Quest

Maqueta topográfica 3D y experiencia en Realidad Mixta (WebXR sobre la mesa) de la Carretera Central (PE-22, Lima a Huancayo), reflejando la decisión de Illapa: **Retrasar la salida 18 horas**.

## Requisitos previos
- Node.js 22+ y `pnpm`.
- Red Wi-Fi compartida entre la computadora y el Meta Quest 3 (para la visualización en realidad mixta).

## Pasos para ejecutar en el monorepo

### 1. Instalar dependencias (desde la raíz del monorepo)
```bash
pnpm install
```

### 2. Iniciar el servidor de desarrollo
```bash
pnpm dev:quest
```
Vite iniciará un servidor seguro con HTTPS y mostrará en la terminal:
- La URL local: `https://localhost:5173`
- La URL en la red local (Network): `https://192.168.x.x:5173`

### 3. Abrir la aplicación
- **En la computadora de escritorio**:
  Abre `https://localhost:5173` en tu navegador. Puedes rotar y hacer zoom en la maqueta 3D con el cursor, o hacer clic sobre el tramo en alerta para enfocarlo.
- **En el Meta Quest 3**:
  1. Abre el **Meta Quest Browser** dentro del visor.
  2. Ingresa la URL HTTPS de la red local (por ejemplo `https://192.168.1.50:5173`).
  3. Al tratarse de un certificado autofirmado local, el navegador del visor mostrará una advertencia de seguridad: pulsa en **Avanzado** (*Advanced*) y luego en **Continuar** (*Proceed*) para aceptar el certificado de la IP local.
  4. Pulsa el botón **Ver en la mesa**. La maqueta se proyectará a escala (~1,2 m de ancho) sobre la mesa física frente a ti con el passthrough activado.
  5. Usa el **gatillo (`select`)** del controlador para fijar el resaltado del tramo o cambiar el perfil de unidad, y el **botón lateral de agarre (`squeeze`)** para re-centrar la maqueta frente a tu posición actual.

## Elementos de la Escena
- **Cinta principal PE-22**: Tramo Lima a Huancayo.
- **Tramo km 70 a 115 (Naranja - Alto)**: *"Lluvia SENAMHI · ahora"*.
- **Copia lateral (Amarillo - Moderado)**: *"Salida +18 h · Moderado"* (el mismo tramo tras retrasar la salida).
- **Cinta de desvío (Teal)**: SUTRAN *"Ruta 3 · Lima – Canta – Huayllay – Unish – Dv. Pasco"* (apta para camiones de hasta 5 ejes).
- **Ficha técnica flotante**: Datos oficiales de SENAMHI sobre Huarochirí con descargo de orientación. Se resalta al apuntar con el cursor o el puntero láser del controlador del Quest.
