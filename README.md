# Music Control & Equalizer — GNOME Shell Extension

A native GNOME Shell Extension for GNOME Shell that integrates a dark glassmorphic **MPRIS Media Controller** and a real-time **System-Wide 10-Band PipeWire Equalizer** with dedicated **Bass & Treble** DSP filters directly into the GNOME Top Bar.

---

## 1. Key Features

### Media Player Control (MPRIS v2.2 over D-Bus)
- Automatically detects and controls any MPRIS-capable player: **Spotify**, **Brave**, **Firefox**, **Chromium / Chrome**, **VLC**, **MPV**, **Amberol**, **Rhythmbox**, etc.
- Displays **Track Title**, **Artist**, **Album**, and **Album Art** (supporting local `file://`, remote `http(s)://`, and `data:image/*;base64` cover art).
- Full transport controls: **Shuffle**, **Previous**, **Play/Pause**, **Next**, and **Repeat** (`None` / `Playlist` / `Track`).
- Interactive **Progress Bar** with click/drag seeking, elapsed time (`MM:SS`), and toggleable remaining (`-MM:SS`) / total duration display.
- **Multi-Player Switcher**: Easily switch between active MPRIS media players when multiple players are open.
- **Hardware Audio Output Selector**: Switch hardware output sinks/ports (e.g., *Headphones*, *Digital Output S/PDIF*, *Line Out*, *HDMI*) directly from the popup header.
- **System Output Volume Slider**: Synchronized in real time with `Gvc.MixerControl` and supports mouse-wheel scrolling on both the slider and the Top Bar icon.

### Real-Time System-Wide Equalizer (PipeWire + WirePlumber)
- **True Audio DSP Processing**: Uses PipeWire's native `libpipewire-module-filter-chain` with built-in biquad filters (`bq_lowshelf`, `bq_peaking`, `bq_highshelf`) and WirePlumber's **Smart Filter** (`filter.smart = true`) routing.
- **10 ISO Octave Frequency Bands** (`-12.0 dB` to `+12.0 dB`):
  `32Hz`, `64Hz`, `125Hz`, `250Hz`, `500Hz`, `1kHz`, `2kHz`, `4kHz`, `8kHz`, `16kHz`.
- **Dedicated Bass & Treble Controls** (`-12.0 dB` to `+12.0 dB`):
  - **Bass**: Low-shelf biquad filter at `100 Hz` (`Q = 0.707`).
  - **Treble**: High-shelf biquad filter at `10 kHz` (`Q = 0.707`).
- **Zero-Glitch Real-Time Parameter Updates**: Updates filter coefficients on the live PipeWire node via `pw-cli s <node-id> Props` without restarting streams.
- **9 Built-in Presets**: *Flat*, *Rock*, *Pop*, *EDM*, *Nightcore*, *Vocal*, *Bass Boost*, *Treble Boost*, *Classical*.
- **Custom Presets**: Save, load, and delete your own custom presets persisted in `GSettings`.
- **Safe Lifecycle**: Runs in user runtime memory (`$XDG_RUNTIME_DIR/music-control-equalizer/filter-chain.conf`). When the extension is disabled or bypassed, the filter process exits cleanly and WirePlumber immediately routes audio directly to your hardware sink without modifying any system configuration files.

---

## 2. Project Structure

```text
Extension-music/
├── metadata.json
├── extension.js
├── prefs.js
├── stylesheet.css
├── src/
│   ├── mpris/
│   │   ├── manager.js          # D-Bus MPRIS discovery & active player arbitration
│   │   └── player.js           # MPRIS v2.2 proxy, metadata parser, seek & transport
│   ├── audio/
│   │   ├── pipewire.js         # PipeWire filter-chain backend & Gvc hardware audio controller
│   │   ├── equalizer.js        # Equalizer state manager, presets & GSettings sync
│   │   └── presets.js          # 10-band definitions, Bass/Treble nodes & built-in presets
│   ├── ui/
│   │   ├── player-widget.js    # Header, Album Art, Output Device pill, Progress & Transport UI
│   │   ├── equalizer-widget.js # 10-band vertical Cairo sliders, presets & Bass/Treble UI
│   │   ├── volume-widget.js    # Reusable Cairo HorizontalSlider & System Volume row
│   │   └── popup.js            # Top Bar PanelMenu.Button indicator & popup container
│   └── utils/
│       ├── settings.js         # Typed GSettings wrapper & custom preset persistence
│       └── helpers.js          # Formatting, clamping, player icon mapping & logging
├── schemas/
│   └── org.gnome.shell.extensions.music-control-equalizer.gschema.xml
├── assets/
│   ├── music-note-symbolic.svg
│   ├── bass-knob-symbolic.svg
│   └── treble-clef-symbolic.svg
├── .gitignore
├── README.md
└── LICENSE
```

---

## 3. Dependencies on Arch Linux

All core dependencies are already part of a standard Arch Linux GNOME + PipeWire desktop:

```bash
sudo pacman -S --needed gnome-shell pipewire wireplumber glib2 curl
```

Verify that PipeWire and WirePlumber are active:

```bash
systemctl --user status pipewire wireplumber
wpctl status
```

---

## 4. Installation

### Option A: Direct Installation to Local Extensions Directory

1. Compile the GSettings schema:
   ```bash
   glib-compile-schemas schemas/
   ```

2. Copy or symlink the extension to `~/.local/share/gnome-shell/extensions/music_control_equalizer@kaz`:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   ln -sfn "$(pwd)" ~/.local/share/gnome-shell/extensions/music_control_equalizer@kaz
   ```

3. Enable the extension:
   ```bash
   gnome-extensions enable music_control_equalizer@kaz
   ```
   *(Note: If GNOME Shell has not yet scanned the newly added extension directory, log out and log back in, or use Option B below to install from a packed ZIP bundle via D-Bus).*

---

## 5. Packaging as a `.zip` Bundle & Installing

Use `gnome-extensions pack` to create a distributable `.shell-extension.zip` archive:

```bash
glib-compile-schemas schemas/

gnome-extensions pack . \
  --force \
  --extra-source=src \
  --extra-source=assets \
  --schema=schemas/org.gnome.shell.extensions.music-control-equalizer.gschema.xml
```

This generates `music_control_equalizer@kaz.shell-extension.zip`.

To install the ZIP package directly:

```bash
gnome-extensions install --force music_control_equalizer@kaz.shell-extension.zip
gnome-extensions enable music_control_equalizer@kaz
```

---

## 6. Debugging & Troubleshooting

### View Extension Logs
Monitor live GNOME Shell logs from this extension:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "\[MusicControlEQ\]"
```

### Verify Real-Time PipeWire Equalizer Routing
1. Check that the smart filter node `effect_input.music_control_eq` is active in PipeWire:
   ```bash
   wpctl status
   pw-link -l | grep music_control_eq
   ```
2. Inspect live biquad filter gains on the PipeWire node:
   ```bash
   NODE_ID=$(pw-dump | grep -B2 '"effect_input.music_control_eq"' | head -n1 | tr -dc '0-9')
   pw-cli e "$NODE_ID" Props | grep -A 2 -E 'eq_bass:Gain|eq_treble:Gain|eq_band_[0-9]+:Gain'
   ```

### Reset Extension Configuration
If you want to reset all saved equalizer gains and custom presets from the terminal:
```bash
gsettings --schemadir ./schemas reset-recursively org.gnome.shell.extensions.music-control-equalizer
```
