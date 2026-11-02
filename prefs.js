// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Preferences Window (GTK4 / Libadwaita)

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {BUILTIN_PRESETS, BUILTIN_PRESET_ORDER} from './src/audio/presets.js';
import {
    VALID_LAYOUT_MODES,
    VALID_POPUP_SCALES,
    ACCENT_PRESETS,
    INTERFACE_SETTING_KEYS,
} from './src/utils/settings.js';

export default class MusicControlEqualizerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(660, 680);

        // =====================================================================
        // PAGE 1: Interface Customization (New Dedicated Page)
        // =====================================================================
        const interfacePage = new Adw.PreferencesPage({
            title: 'Interface Customization',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(interfacePage);

        // 1. Layout Mode Selection Group
        const layoutGroup = new Adw.PreferencesGroup({
            title: 'Popup Layout Mode',
            description: 'Switch between 5 built-in popup layouts in real time without restarting GNOME Shell.',
        });
        interfacePage.add(layoutGroup);

        const layoutLabels = new Gtk.StringList({
            strings: [
                'Layout 1 – Dual Panel (Left: Music & Media | Right: Equalizer)',
                'Layout 2 – Vertical (Top: Music & Media | Bottom: Equalizer)',
                'Layout 3 – Compact (Condensed Minimal Interface)',
                'Layout 4 – Music Only (Media & Playback Only)',
                'Layout 5 – Equalizer Only (10-Band EQ & Tone Only)',
            ],
        });

        const layoutRow = new Adw.ComboRow({
            title: 'Active Interface Layout',
            subtitle: 'Dual Panel is the default side-by-side workspace layout',
            model: layoutLabels,
        });

        const syncLayoutCombo = () => {
            const cur = settings.get_string('layout-mode');
            const idx = VALID_LAYOUT_MODES.indexOf(cur);
            layoutRow.selected = idx >= 0 ? idx : 0;
        };
        syncLayoutCombo();

        layoutRow.connect('notify::selected', () => {
            const idx = layoutRow.selected;
            if (idx >= 0 && idx < VALID_LAYOUT_MODES.length) {
                const target = VALID_LAYOUT_MODES[idx];
                if (settings.get_string('layout-mode') !== target)
                    settings.set_string('layout-mode', target);
            }
        });
        settings.connect('changed::layout-mode', syncLayoutCombo);
        layoutGroup.add(layoutRow);

        // 2. Dimensions & Sizing Group
        const sizeGroup = new Adw.PreferencesGroup({
            title: 'Popup Size & Panel Widths',
            description: 'Customize overall popup scale and individual panel widths (Left 1/3 Music, Right 2/3 Equalizer).',
        });
        interfacePage.add(sizeGroup);

        const scaleLabels = new Gtk.StringList({
            strings: ['Small (90%)', 'Medium (100% Default)', 'Large (112%)'],
        });
        const scaleRow = new Adw.ComboRow({
            title: 'Popup Scale',
            subtitle: 'Overall size multiplier for the popup window',
            model: scaleLabels,
        });
        const syncScaleCombo = () => {
            const cur = settings.get_string('popup-scale');
            const idx = VALID_POPUP_SCALES.indexOf(cur);
            scaleRow.selected = idx >= 0 ? idx : 1;
        };
        syncScaleCombo();
        scaleRow.connect('notify::selected', () => {
            const idx = scaleRow.selected;
            if (idx >= 0 && idx < VALID_POPUP_SCALES.length) {
                const target = VALID_POPUP_SCALES[idx];
                if (settings.get_string('popup-scale') !== target)
                    settings.set_string('popup-scale', target);
            }
        });
        settings.connect('changed::popup-scale', syncScaleCombo);
        sizeGroup.add(scaleRow);

        const leftWidthAdj = new Gtk.Adjustment({
            lower: 240,
            upper: 460,
            step_increment: 10,
            page_increment: 20,
            value: settings.get_int('left-panel-width'),
        });
        const leftWidthRow = new Adw.SpinRow({
            title: 'Music & Media Panel Width (px)',
            subtitle: 'Width of the left panel in Dual Panel layout (default: 310 px)',
            adjustment: leftWidthAdj,
        });
        settings.bind(
            'left-panel-width',
            leftWidthAdj,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        sizeGroup.add(leftWidthRow);

        const rightWidthAdj = new Gtk.Adjustment({
            lower: 420,
            upper: 780,
            step_increment: 10,
            page_increment: 20,
            value: settings.get_int('right-panel-width'),
        });
        const rightWidthRow = new Adw.SpinRow({
            title: 'Equalizer Panel Width (px)',
            subtitle: 'Width of the right panel in Dual Panel layout (default: 560 px)',
            adjustment: rightWidthAdj,
        });
        settings.bind(
            'right-panel-width',
            rightWidthAdj,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        sizeGroup.add(rightWidthRow);

        // 3. Component Visibility Group
        const visibilityGroup = new Adw.PreferencesGroup({
            title: 'Component Visibility',
            description: 'Show or hide individual UI sections inside the popup.',
        });
        interfacePage.add(visibilityGroup);

        const albumArtRow = new Adw.SwitchRow({
            title: 'Show Album Art',
            subtitle: 'Display cover artwork in the Music & Media header',
        });
        settings.bind('show-album-art', albumArtRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(albumArtRow);

        const mediaSourceRow = new Adw.SwitchRow({
            title: 'Show Media Source Card',
            subtitle: 'Display current stream source (e.g. Spotify, YouTube Video, Brave, VLC) at the bottom of the Music panel',
        });
        settings.bind('show-media-source', mediaSourceRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(mediaSourceRow);

        const bassTrebleRow = new Adw.SwitchRow({
            title: 'Show Bass & Treble Controls',
            subtitle: 'Display Bass and Treble shelf sliders below the 10-band Equalizer',
        });
        settings.bind('show-bass-treble', bassTrebleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(bassTrebleRow);

        const timeInfoRow = new Adw.SwitchRow({
            title: 'Show Track Time Information',
            subtitle: 'Display current elapsed time and remaining/total time under the progress bar',
        });
        settings.bind('show-time-info', timeInfoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(timeInfoRow);

        // 4. Theme, Accent Color & Glassmorphism Opacity Group
        const themeGroup = new Adw.PreferencesGroup({
            title: 'Theme, Accent Color & Glassmorphism',
            description: 'Customize accent color and dark glassmorphic background opacity.',
        });
        interfacePage.add(themeGroup);

        const accentNames = new Gtk.StringList({
            strings: ACCENT_PRESETS.map(p => `${p.name} (${p.id})`),
        });
        const accentRow = new Adw.ComboRow({
            title: 'Accent Color',
            subtitle: 'Active slider fill, play button, and DSP badge highlight color',
            model: accentNames,
        });
        const syncAccentCombo = () => {
            const cur = (settings.get_string('accent-color') || '#257ef9').toLowerCase();
            const idx = ACCENT_PRESETS.findIndex(p => p.id.toLowerCase() === cur);
            accentRow.selected = idx >= 0 ? idx : 0;
        };
        syncAccentCombo();
        accentRow.connect('notify::selected', () => {
            const preset = ACCENT_PRESETS[accentRow.selected];
            if (preset && settings.get_string('accent-color') !== preset.id)
                settings.set_string('accent-color', preset.id);
        });
        settings.connect('changed::accent-color', syncAccentCombo);
        themeGroup.add(accentRow);

        const opacityAdj = new Gtk.Adjustment({
            lower: 65,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('popup-opacity'),
        });
        const opacityRow = new Adw.SpinRow({
            title: 'Popup Background Opacity (%)',
            subtitle: 'Adjust dark glassmorphic transparency (65% translucent to 100% solid)',
            adjustment: opacityAdj,
        });
        settings.bind(
            'popup-opacity',
            opacityAdj,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        themeGroup.add(opacityRow);

        // Restore Default Interface Button
        const restoreUiGroup = new Adw.PreferencesGroup({
            title: 'Restore Default Interface',
            description: 'Reset layout, panel sizes, visibility toggles, and theme back to Dual Panel defaults without touching Equalizer presets.',
        });
        interfacePage.add(restoreUiGroup);

        const restoreUiRow = new Adw.ActionRow({
            title: 'Restore Default Interface Layout',
            subtitle: 'Revert all Interface Customization options to defaults',
        });
        const restoreUiBtn = new Gtk.Button({
            label: 'Restore Interface Defaults',
            valign: Gtk.Align.CENTER,
        });
        restoreUiBtn.connect('clicked', () => {
            for (const key of INTERFACE_SETTING_KEYS)
                settings.reset(key);
        });
        restoreUiRow.add_suffix(restoreUiBtn);
        restoreUiGroup.add(restoreUiRow);

        // =====================================================================
        // PAGE 2: Audio, Equalizer & Top Bar Settings
        // =====================================================================
        const audioPage = new Adw.PreferencesPage({
            title: 'Audio & Equalizer',
            icon_name: 'audio-x-generic-symbolic',
        });
        window.add(audioPage);

        // 1. Panel & Player Preferences Group
        const panelGroup = new Adw.PreferencesGroup({
            title: 'Top Bar & Media Player',
            description: 'Configure how the indicator and media player behave on the GNOME Top Bar.',
        });
        audioPage.add(panelGroup);

        const positions = ['right', 'center', 'left'];
        const positionLabels = new Gtk.StringList({
            strings: ['Right', 'Center', 'Left'],
        });
        const posRow = new Adw.ComboRow({
            title: 'Top Bar Position',
            subtitle: 'Placement of the Music icon on the GNOME Top Bar',
            model: positionLabels,
        });
        const currentPos = settings.get_string('panel-position');
        posRow.selected = Math.max(0, positions.indexOf(currentPos));
        posRow.connect('notify::selected', () => {
            const idx = posRow.selected;
            if (idx >= 0 && idx < positions.length)
                settings.set_string('panel-position', positions[idx]);
        });
        panelGroup.add(posRow);

        const showTrackRow = new Adw.SwitchRow({
            title: 'Show Track Title in Top Bar',
            subtitle: 'Display the currently playing song title next to the Top Bar icon',
        });
        settings.bind(
            'show-track-in-panel',
            showTrackRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        panelGroup.add(showTrackRow);

        const remainingTimeRow = new Adw.SwitchRow({
            title: 'Show Remaining Track Time',
            subtitle: 'Display remaining time (-MM:SS) instead of total duration on the right side of the progress bar',
        });
        settings.bind(
            'show-remaining-time',
            remainingTimeRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        panelGroup.add(remainingTimeRow);

        // 2. PipeWire System-Wide Equalizer Group
        const eqGroup = new Adw.PreferencesGroup({
            title: 'System-Wide PipeWire Equalizer',
            description: 'Real-time 10-band biquad DSP filter chain + Bass & Treble shelf filters via PipeWire.',
        });
        audioPage.add(eqGroup);

        const eqEnabledRow = new Adw.SwitchRow({
            title: 'Enable Real-Time Audio Equalizer',
            subtitle: 'Process system audio through the PipeWire filter-chain equalizer',
        });
        settings.bind(
            'equalizer-enabled',
            eqEnabledRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        eqGroup.add(eqEnabledRow);

        const presetNames = BUILTIN_PRESET_ORDER.map(id => BUILTIN_PRESETS[id].name);
        const presetModel = new Gtk.StringList({strings: presetNames});
        const presetRow = new Adw.ComboRow({
            title: 'Default Built-in Preset',
            subtitle: 'Quickly apply one of the built-in acoustic presets',
            model: presetModel,
        });

        const curPreset = settings.get_string('active-preset');
        const curIdx = BUILTIN_PRESET_ORDER.indexOf(curPreset);
        if (curIdx >= 0)
            presetRow.selected = curIdx;

        presetRow.connect('notify::selected', () => {
            const id = BUILTIN_PRESET_ORDER[presetRow.selected];
            const preset = BUILTIN_PRESETS[id];
            if (!preset)
                return;
            settings.set_value('band-gains', new GLib.Variant('ad', preset.bands));
            settings.set_double('bass-gain', preset.bass);
            settings.set_double('treble-gain', preset.treble);
            settings.set_string('active-preset', id);
        });
        eqGroup.add(presetRow);

        // 3. Reset & Restore Group
        const resetGroup = new Adw.PreferencesGroup({
            title: 'Maintenance & Reset',
            description: 'Restore equalizer gains or reset all extension configuration to defaults.',
        });
        audioPage.add(resetGroup);

        const resetEqRow = new Adw.ActionRow({
            title: 'Reset Equalizer to Flat',
            subtitle: 'Set all 10 frequency bands, Bass, and Treble back to 0.0 dB',
        });
        const resetEqBtn = new Gtk.Button({
            label: 'Reset EQ',
            valign: Gtk.Align.CENTER,
        });
        resetEqBtn.connect('clicked', () => {
            const flat = BUILTIN_PRESETS.flat;
            settings.set_value('band-gains', new GLib.Variant('ad', flat.bands));
            settings.set_double('bass-gain', 0.0);
            settings.set_double('treble-gain', 0.0);
            settings.set_string('active-preset', 'flat');
        });
        resetEqRow.add_suffix(resetEqBtn);
        resetGroup.add(resetEqRow);

        const resetAllRow = new Adw.ActionRow({
            title: 'Restore Factory Defaults',
            subtitle: 'Reset all audio, equalizer, and interface settings',
        });
        const resetAllBtn = new Gtk.Button({
            label: 'Restore All Defaults',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetAllBtn.connect('clicked', () => {
            const keys = [
                'equalizer-enabled',
                'active-preset',
                'band-gains',
                'bass-gain',
                'treble-gain',
                'custom-presets',
                'preferred-player',
                'show-remaining-time',
                'show-track-in-panel',
                'panel-position',
                ...INTERFACE_SETTING_KEYS,
            ];
            for (const key of keys)
                settings.reset(key);
        });
        resetAllRow.add_suffix(resetAllBtn);
        resetGroup.add(resetAllRow);
    }
}
