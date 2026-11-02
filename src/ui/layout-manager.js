// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Modular Popup Layout Engine
// Supports live switching between:
//   1. DualPanelLayout   (Left: Music & Media 1/3 square card | Right: Equalizer 2/3 rectangular card)
//   2. VerticalLayout    (Top: Music & Media | Bottom: Equalizer)
//   3. CompactLayout     (Condensed spacing & compact controls)
//   4. MusicOnlyLayout   (Only Music & Media panel)
//   5. EqualizerOnlyLayout (Only Equalizer panel)

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {LayoutMode} from '../utils/settings.js';
import {clamp} from '../utils/helpers.js';

export class PopupLayoutManager {
    /**
     * @param {object} params
     * @param {St.BoxLayout} params.rootContainer
     * @param {St.Widget} params.popupBox
     * @param {import('./player-widget.js').PlayerWidget} params.musicPanel
     * @param {import('./equalizer-widget.js').EqualizerWidget} params.equalizerPanel
     * @param {import('../utils/settings.js').SettingsManager} params.settings
     */
    constructor({rootContainer, popupBox, musicPanel, equalizerPanel, settings}) {
        this._root = rootContainer;
        this._popupBox = popupBox;
        this._musicPanel = musicPanel;
        this._eqPanel = equalizerPanel;
        this._settings = settings;
        this._destroyed = false;

        // Left wrapper (Music & Media Panel container)
        this._leftPane = new St.BoxLayout({
            style_class: 'mce-left-music-pane',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // Right wrapper (Equalizer Control Panel container)
        this._rightPane = new St.BoxLayout({
            style_class: 'mce-right-eq-pane',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        this._leftPane.add_child(this._musicPanel.actor);
        this._rightPane.add_child(this._eqPanel.actor);

        this._root.add_child(this._leftPane);
        this._root.add_child(this._rightPane);

        this.applyLayout();
    }

    /**
     * Compute screen-aware clamped dimensions so the popup fits on any monitor resolution.
     *
     * @returns {{maxWidth: number, maxHeight: number}}
     */
    _getMonitorWorkAreaBounds() {
        let maxW = 1280;
        let maxH = 800;
        try {
            if (typeof global !== 'undefined' && global.display) {
                const monitorIdx = global.display.get_primary_monitor();
                const rect = global.display.get_monitor_geometry(monitorIdx);
                if (rect && rect.width > 0 && rect.height > 0) {
                    maxW = Math.max(480, rect.width - 48);
                    maxH = Math.max(420, rect.height - 84);
                }
            }
        } catch (_e) {
            // Fallback to safe defaults
        }
        return {maxWidth: maxW, maxHeight: maxH};
    }

    /**
     * Live-apply the selected layout mode, panel widths, popup scale, and background opacity
     * without destroying the underlying MPRIS or Equalizer widgets.
     */
    applyLayout() {
        if (this._destroyed || !this._root)
            return;

        const mode = this._settings.layoutMode;
        const scale = this._settings.popupScaleFactor;
        const opacityPct = this._settings.popupOpacity;
        const alpha = clamp(opacityPct / 100, 0.65, 1.0).toFixed(2);
        const {maxWidth} = this._getMonitorWorkAreaBounds();

        // Update popup background glassmorphism opacity
        if (this._popupBox) {
            this._popupBox.style = `background-color: rgba(20, 21, 27, ${alpha});`;
        }

        // Clear previous layout mode classes
        const modeClasses = [
            'mce-layout-dual-panel',
            'mce-layout-vertical',
            'mce-layout-compact',
            'mce-layout-music-only',
            'mce-layout-eq-only',
        ];
        for (const cls of modeClasses)
            this._root.remove_style_class_name(cls);

        const isCompact = mode === LayoutMode.COMPACT;
        this._musicPanel.setCompactMode(isCompact);
        this._eqPanel.setCompactMode(isCompact);
        this._musicPanel.syncInterfaceSettings();
        this._eqPanel.syncInterfaceSettings();

        const rawLeftW = Math.round(this._settings.leftPanelWidth * scale);
        const rawRightW = Math.round(this._settings.rightPanelWidth * scale);

        switch (mode) {
        case LayoutMode.DUAL_PANEL:
            this._applyDualPanelLayout(rawLeftW, rawRightW, maxWidth);
            break;
        case LayoutMode.VERTICAL:
            this._applyVerticalLayout(rawLeftW, rawRightW, maxWidth);
            break;
        case LayoutMode.COMPACT:
            this._applyCompactLayout(rawLeftW, rawRightW, maxWidth);
            break;
        case LayoutMode.MUSIC_ONLY:
            this._applyMusicOnlyLayout(rawLeftW, maxWidth);
            break;
        case LayoutMode.EQ_ONLY:
            this._applyEqOnlyLayout(rawRightW, maxWidth);
            break;
        default:
            this._applyDualPanelLayout(rawLeftW, rawRightW, maxWidth);
            break;
        }
    }

    /**
     * Layout 1 – Dual Panel (Default):
     * Left: Music & Media (~1/3 square panel) | Right: Equalizer (~2/3 rectangular panel)
     */
    _applyDualPanelLayout(leftW, rightW, maxWidth) {
        this._root.add_style_class_name('mce-layout-dual-panel');
        this._root.orientation = Clutter.Orientation.HORIZONTAL;

        let finalLeft = clamp(leftW, 250, 460);
        let finalRight = clamp(rightW, 430, 780);

        const totalRequested = finalLeft + finalRight + 52;
        if (totalRequested > maxWidth) {
            const ratio = (maxWidth - 52) / (finalLeft + finalRight);
            finalLeft = Math.max(240, Math.floor(finalLeft * ratio));
            finalRight = Math.max(400, Math.floor(finalRight * ratio));
        }

        this._leftPane.visible = true;
        this._rightPane.visible = true;

        this._leftPane.style = `width: ${finalLeft}px;`;
        this._rightPane.style = `width: ${finalRight}px;`;
        this._root.style = null;
    }

    /**
     * Layout 2 – Vertical:
     * Top: Music & Media | Bottom: Equalizer
     */
    _applyVerticalLayout(_leftW, rightW, maxWidth) {
        this._root.add_style_class_name('mce-layout-vertical');
        this._root.orientation = Clutter.Orientation.VERTICAL;

        const width = Math.min(maxWidth - 40, clamp(rightW, 420, 620));

        this._leftPane.visible = true;
        this._rightPane.visible = true;

        this._leftPane.style = `width: ${width}px;`;
        this._rightPane.style = `width: ${width}px;`;
        this._root.style = null;
    }

    /**
     * Layout 3 – Compact:
     * Condensed spacing and compact dimensions for smaller screens
     */
    _applyCompactLayout(_leftW, _rightW, maxWidth) {
        this._root.add_style_class_name('mce-layout-compact');
        this._root.orientation = Clutter.Orientation.VERTICAL;

        const width = Math.min(maxWidth - 40, 396);

        this._leftPane.visible = true;
        this._rightPane.visible = true;

        this._leftPane.style = `width: ${width}px;`;
        this._rightPane.style = `width: ${width}px;`;
        this._root.style = 'padding: 12px 14px; spacing: 8px;';
    }

    /**
     * Layout 4 – Music Only:
     * Only shows the Music & Media panel
     */
    _applyMusicOnlyLayout(leftW, maxWidth) {
        this._root.add_style_class_name('mce-layout-music-only');
        this._root.orientation = Clutter.Orientation.VERTICAL;

        const width = Math.min(maxWidth - 40, clamp(Math.max(340, leftW), 280, 480));

        this._leftPane.visible = true;
        this._rightPane.visible = false;

        this._leftPane.style = `width: ${width}px;`;
        this._root.style = null;
    }

    /**
     * Layout 5 – Equalizer Only:
     * Only shows the Equalizer panel
     */
    _applyEqOnlyLayout(rightW, maxWidth) {
        this._root.add_style_class_name('mce-layout-eq-only');
        this._root.orientation = Clutter.Orientation.VERTICAL;

        const width = Math.min(maxWidth - 40, clamp(rightW, 420, 740));

        this._leftPane.visible = false;
        this._rightPane.visible = true;

        this._rightPane.style = `width: ${width}px;`;
        this._root.style = null;
    }

    destroy() {
        this._destroyed = true;
        this._leftPane = null;
        this._rightPane = null;
        this._root = null;
    }
}
