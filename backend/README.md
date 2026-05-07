## LED hardware mode

The backend defaults to safe auto-detection:

```bash
LED_HARDWARE_MODE=auto
```

Supported values:

- `auto`: try `rpi_ws281x` only when the host looks like a Raspberry Pi.
- `force`: always import and initialize `rpi_ws281x`.
- `sim`: never import Raspberry Pi libraries; keep the in-memory frame buffer only.

For local development, use `LED_HARDWARE_MODE=sim`. On the deployed Raspberry Pi,
`auto` is usually enough, and `force` is available if hardware detection needs to
be bypassed.

You can inspect the active mode at:

```text
GET /api/hardware
```
