// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Main GNOME Shell Extension Entry Point

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingsManager} from './src/utils/settings.js';
import {Logger} from './src/utils/helpers.js';
import {SystemAudioController} from './src/audio/pipewire.js';
import {EqualizerManager} from './src/audio/equalizer.js';
import {MprisManager} from './src/mpris/manager.js';
import {MusicEqualizerIndicator} from './src/ui/popup.js';

export default class MusicControlEqualizerExtension extends Extension {
    enable() {
        Logger.info('Enabling Music Control & Equalizer extension');

        this._settings = new SettingsManager(this.getSettings());
        this._audioController = new SystemAudioController();
        this._equalizerManager = new EqualizerManager(this._settings);
        this._mprisManager = new MprisManager(this._settings);

        this._createIndicator();

        this._settings.connectChanged('panel-position', () => {
            this._recreateIndicator();
        });
    }

    _createIndicator() {
        this._indicator = new MusicEqualizerIndicator({
            mprisManager: this._mprisManager,
            audioController: this._audioController,
            equalizerManager: this._equalizerManager,
            settings: this._settings,
            extensionPath: this.path,
            onOpenPreferences: () => {
                try {
                    this.openPreferences();
                } catch (e) {
                    Logger.warn('Failed to open extension preferences', e);
                }
            },
        });

        const pos = this._settings.panelPosition;
        const validBox = ['left', 'center', 'right'].includes(pos) ? pos : 'right';
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, validBox);
    }

    _recreateIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._createIndicator();
    }

    disable() {
        Logger.info('Disabling Music Control & Equalizer extension');

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._mprisManager) {
            this._mprisManager.destroy();
            this._mprisManager = null;
        }

        if (this._equalizerManager) {
            this._equalizerManager.destroy();
            this._equalizerManager = null;
        }

        if (this._audioController) {
            this._audioController.destroy();
            this._audioController = null;
        }

        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }
}
