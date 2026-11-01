// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Preferences Window (GTK4 / Libadwaita)

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/shell/extensions/prefs.js';
import {BUILTIN_PRESETS, BUILTIN_PRESET_ORDER} from './src/audio/presets.js';

export default class MusicControlEqualizerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(600, 560);

        const page = new Adw.PreferencesPage({
            title: 'Music & Equalizer',
            icon_name: 'audio-x-generic-symbolic',
        });
        window.add(page);

        // 1. Panel & Player Preferences Group
        const panelGroup = new Adw.PreferencesGroup({
            title: 'Top Bar & Media Player',
            description: 'Configure how the indicator and media player behave on the GNOME Top Bar.',
        });
        page.add(panelGroup);

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
        page.add(eqGroup);

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
        page.add(resetGroup);

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
            subtitle: 'Reset all settings and delete custom presets',
        });
        const resetAllBtn = new Gtk.Button({
            label: 'Restore Defaults',
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
            ];
            for (const key of keys)
                settings.reset(key);
        });
        resetAllRow.add_suffix(resetAllBtn);
        resetGroup.add(resetAllRow);
    }
}
