// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - MPRIS D-Bus Discovery & Player Selection Manager

import Gio from 'gi://Gio';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {MprisPlayerController} from './player.js';
import {Logger} from '../utils/helpers.js';

const DBUS_IFACE_XML = `
<node>
  <interface name="org.freedesktop.DBus">
    <method name="ListNames">
      <arg type="as" direction="out" name="names"/>
    </method>
    <signal name="NameOwnerChanged">
      <arg type="s" direction="out" name="name"/>
      <arg type="s" direction="out" name="oldOwner"/>
      <arg type="s" direction="out" name="newOwner"/>
    </signal>
  </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

export class MprisManager extends EventEmitter {
    /**
     * @param {import('../utils/settings.js').SettingsManager} settings
     */
    constructor(settings) {
        super();

        this._settings = settings;
        this._players = new Map();
        this._activeBusName = null;
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();
        this._nameOwnerSignalId = 0;

        this._dbusProxy = new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            (proxy, error) => {
                if (this._destroyed)
                    return;
                if (error) {
                    Logger.error('Failed to connect to org.freedesktop.DBus for MPRIS discovery', error);
                    return;
                }
                this._onDBusProxyReady();
            },
            this._cancellable
        );
    }

    async _onDBusProxyReady() {
        if (this._destroyed || !this._dbusProxy)
            return;

        this._nameOwnerSignalId = this._dbusProxy.connectSignal(
            'NameOwnerChanged',
            (_proxy, _sender, [name, oldOwner, newOwner]) => {
                if (this._destroyed || !name.startsWith(MPRIS_PREFIX))
                    return;

                if (oldOwner && !newOwner)
                    this._removePlayer(name);
                else if (newOwner && !oldOwner)
                    this._addPlayer(name);
            }
        );

        try {
            const [names] = await this._dbusProxy.ListNamesAsync();
            if (this._destroyed || !Array.isArray(names))
                return;

            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._addPlayer(name);
            }
        } catch (e) {
            if (!this._destroyed)
                Logger.error('Error listing D-Bus names for MPRIS', e);
        }
    }

    _addPlayer(busName) {
        if (this._destroyed || this._players.has(busName))
            return;

        const player = new MprisPlayerController(busName);
        this._players.set(busName, player);

        player.connect('ready', () => {
            if (this._destroyed)
                return;
            this._selectBestPlayer();
            this.emit('players-changed');
        });

        player.connect('changed', () => {
            if (this._destroyed)
                return;

            // If another player starts playing while the current one is paused/stopped,
            // automatically promote the playing one unless user explicitly locked onto a playing player
            if (player.isPlaying && this._activeBusName !== busName) {
                const current = this.activePlayer;
                if (!current || !current.isPlaying) {
                    this._activeBusName = busName;
                    this.emit('active-player-changed', player);
                }
            }

            if (this._activeBusName === busName)
                this.emit('active-player-updated', player);

            this.emit('players-changed');
        });

        player.connect('position-changed', (_p, posUs) => {
            if (!this._destroyed && this._activeBusName === busName)
                this.emit('active-position-changed', posUs);
        });

        player.connect('closed', () => {
            this._removePlayer(busName);
        });

        this._selectBestPlayer();
        this.emit('players-changed');
    }

    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;

        this._players.delete(busName);
        player.destroy();

        if (this._activeBusName === busName) {
            this._activeBusName = null;
            this._selectBestPlayer();
        }

        this.emit('players-changed');
    }

    _selectBestPlayer() {
        if (this._players.size === 0) {
            if (this._activeBusName !== null) {
                this._activeBusName = null;
                this.emit('active-player-changed', null);
            }
            return;
        }

        if (this._activeBusName && this._players.has(this._activeBusName))
            return;

        const preferred = this._settings.preferredPlayer;
        const allPlayers = [...this._players.values()];

        // 1. Currently playing player
        let chosen = allPlayers.find(p => p.isPlaying);

        // 2. User's preferred player if available
        if (!chosen && preferred && this._players.has(preferred))
            chosen = this._players.get(preferred);

        // 3. Player with metadata loaded
        if (!chosen)
            chosen = allPlayers.find(p => p.hasMetadata);

        // 4. First available player
        if (!chosen)
            chosen = allPlayers[0];

        const nextBus = chosen ? chosen.busName : null;
        if (this._activeBusName !== nextBus) {
            this._activeBusName = nextBus;
            this.emit('active-player-changed', this.activePlayer);
        }
    }

    /**
     * @returns {MprisPlayerController|null}
     */
    get activePlayer() {
        if (!this._activeBusName)
            return null;
        return this._players.get(this._activeBusName) || null;
    }

    /**
     * @returns {MprisPlayerController[]}
     */
    get players() {
        return [...this._players.values()];
    }

    /**
     * Manually switch the active MPRIS player by busName.
     *
     * @param {string} busName
     */
    setActivePlayer(busName) {
        if (!this._players.has(busName))
            return;

        this._activeBusName = busName;
        this._settings.preferredPlayer = busName;
        const player = this.activePlayer;
        player?.refreshPosition();
        this.emit('active-player-changed', player);
        this.emit('players-changed');
    }

    destroy() {
        this._destroyed = true;

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._dbusProxy) {
            if (this._nameOwnerSignalId) {
                this._dbusProxy.disconnectSignal(this._nameOwnerSignalId);
                this._nameOwnerSignalId = 0;
            }
            this._dbusProxy = null;
        }

        for (const player of this._players.values())
            player.destroy();
        this._players.clear();
        this._activeBusName = null;

        this.disconnectAll();
    }
}
