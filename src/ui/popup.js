// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Top Bar Indicator & Main Popup Container

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {PlayerWidget} from './player-widget.js';
import {VolumeWidget} from './volume-widget.js';
import {EqualizerWidget} from './equalizer-widget.js';

export const MusicEqualizerIndicator = GObject.registerClass(
class MusicEqualizerIndicator extends PanelMenu.Button {
    /**
     * @param {object} params
     * @param {import('../mpris/manager.js').MprisManager} params.mprisManager
     * @param {import('../audio/pipewire.js').SystemAudioController} params.audioController
     * @param {import('../audio/equalizer.js').EqualizerManager} params.equalizerManager
     * @param {import('../utils/settings.js').SettingsManager} params.settings
     * @param {string} params.extensionPath
     */
    _init({mprisManager, audioController, equalizerManager, settings, extensionPath}) {
        super._init(0.5, 'Music Control & Equalizer', false);

        this._mpris = mprisManager;
        this._audio = audioController;
        this._eq = equalizerManager;
        this._settings = settings;
        this._extensionPath = extensionPath;

        this._buildPanelIndicator();
        this._buildPopupContent();
        this._bindSignals();
        this._syncPanelIndicator();
    }

    _buildPanelIndicator() {
        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box mce-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/assets/music-note-symbolic.svg`),
            style_class: 'system-status-icon mce-panel-icon',
            icon_size: 16,
        });

        this._panelLabel = new St.Label({
            text: '',
            style_class: 'mce-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._panelLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._panelBox.add_child(this._panelIcon);
        this._panelBox.add_child(this._panelLabel);
        this.add_child(this._panelBox);

        // Scroll on the Top Bar indicator to adjust output volume smoothly
        const scrollController = new Clutter.ScrollController({
            flags: Clutter.ScrollControllerFlags.DISCRETE |
                Clutter.ScrollControllerFlags.SCROLL_VERTICAL,
        });
        scrollController.connect('scroll', (_ctrl, _sprite, _src, _dx, dy) => {
            const current = this._audio.getVolume();
            this._audio.setVolume(current - dy * 0.04);
            return Clutter.EVENT_STOP;
        });
        this.add_action(scrollController);
    }

    _buildPopupContent() {
        this.menu.box.add_style_class_name('mce-popup-box');

        this._rootContainer = new St.BoxLayout({
            style_class: 'mce-popup-root',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });

        this._playerWidget = new PlayerWidget(
            this._mpris,
            this._audio,
            this._settings,
            this._extensionPath
        );

        this._volumeWidget = new VolumeWidget(this._audio);

        this._equalizerWidget = new EqualizerWidget(
            this._eq,
            this._extensionPath
        );

        this._rootContainer.add_child(this._playerWidget.actor);
        this._rootContainer.add_child(this._volumeWidget.actor);
        this._rootContainer.add_child(this._equalizerWidget.actor);

        this.menu.box.add_child(this._rootContainer);

        this._menuOpenSignalId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            this._playerWidget.setPopupOpen(isOpen);
            if (!isOpen)
                this._equalizerWidget.closeDrawers();
        });
    }

    _bindSignals() {
        this._mprisSignalIds = [
            this._mpris.connect('active-player-changed', () => this._syncPanelIndicator()),
            this._mpris.connect('active-player-updated', () => this._syncPanelIndicator()),
        ];

        this._settings.connectChanged('show-track-in-panel', () => {
            this._syncPanelIndicator();
        });
    }

    _syncPanelIndicator() {
        const player = this._mpris.activePlayer;
        const showTrack = this._settings.showTrackInPanel;

        if (player && player.isPlaying)
            this._panelIcon.add_style_class_name('playing');
        else
            this._panelIcon.remove_style_class_name('playing');

        if (showTrack && player && player.hasMetadata) {
            this._panelLabel.visible = true;
            this._panelLabel.text = player.title;
        } else {
            this._panelLabel.visible = false;
            this._panelLabel.text = '';
        }
    }

    destroy() {
        if (this.menu && this._menuOpenSignalId) {
            this.menu.disconnect(this._menuOpenSignalId);
            this._menuOpenSignalId = 0;
        }

        if (this._mpris && this._mprisSignalIds) {
            for (const id of this._mprisSignalIds)
                this._mpris.disconnect(id);
            this._mprisSignalIds = [];
        }

        this._playerWidget?.destroy();
        this._playerWidget = null;

        this._volumeWidget?.destroy();
        this._volumeWidget = null;

        this._equalizerWidget?.destroy();
        this._equalizerWidget = null;

        super.destroy();
    }
});
