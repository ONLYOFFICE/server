/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

// Min-heap based session scheduler with batch processing.
// Processes all expired entries once per tick to reduce setTimeout pressure.

class MinHeap {
	constructor() {
		this._data = [];
	}

	_peek() {
		return this._data.length > 0 ? this._data[0] : null;
	}

	_push(item) {
		this._data.push(item);
		this._siftUp(this._data.length - 1);
	}

	_pop() {
		if (this._data.length === 0) return null;
		const top = this._data[0];
		const last = this._data.pop();
		if (this._data.length > 0) {
			this._data[0] = last;
			this._siftDown(0);
		}
		return top;
	}

	_siftUp(index) {
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (this._data[parent].time <= this._data[index].time) break;
			[this._data[parent], this._data[index]] = [this._data[index], this._data[parent]];
			index = parent;
		}
	}

	_siftDown(index) {
		const length = this._data.length;
		while (true) {
			let left = index * 2 + 1;
			let right = index * 2 + 2;
			let smallest = index;
			if (left < length && this._data[left].time < this._data[smallest].time) smallest = left;
			if (right < length && this._data[right].time < this._data[smallest].time) smallest = right;
			if (smallest === index) break;
			[this._data[smallest], this._data[index]] = [this._data[index], this._data[smallest]];
			index = smallest;
		}
	}
}

class SessionScheduler {
	constructor() {
		this._tickMs = 1000;
		this._heap = new MinHeap();
		this._stateByConnId = new Map();
		this._intervalId = null;
		this._callbacks = {
			onIdleWarning: async () => {},
			onIdleClose: async () => {},
			onAbsoluteWarning: async () => {},
			onAbsoluteClose: async () => {}
		};
	}

	init(options, callbacks) {
		if (options && typeof options.tickMs === 'number' && options.tickMs > 0) {
			this._tickMs = options.tickMs;
		}
		if (callbacks) {
			this._callbacks = { ...this._callbacks, ...callbacks };
		}
		if (!this._intervalId) {
			this._intervalId = setInterval(() => { this._onTick(); }, this._tickMs);
		}
	}

	shutdown() {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}
		this._heap = new MinHeap();
		this._stateByConnId.clear();
	}

	registerConnection(conn, options) {
		const now = Date.now();
		const idleMs = Math.max(0, options.idleMs || 0);
		const absoluteMs = Math.max(0, options.absoluteMs || 0);
		const state = {
			conn,
			connId: conn.id,
			lastActionTs: conn.sessionTimeLastAction || now,
			connectTs: conn.sessionTimeConnect || now,
			idleMs,
			absoluteMs,
			idleVersion: 0,
			absoluteVersion: 0,
			idleWarned: false,
			absoluteWarned: false,
			removed: false
		};
		this._stateByConnId.set(conn.id, state);
		if (idleMs > 0) {
			this._scheduleIdle(state, state.lastActionTs + idleMs);
		}
		if (absoluteMs > 0) {
			this._scheduleAbsolute(state, state.connectTs + absoluteMs);
		}
	}

	recordActivity(connId, lastActionTs) {
		const state = this._stateByConnId.get(connId);
		if (!state || state.removed) return;
		state.lastActionTs = lastActionTs || Date.now();
		state.idleWarned = false; // reset warning on activity
		// Do not reschedule here; we follow the deferred scheduling model.
	}

	configureConnection(connId, options) {
		const state = this._stateByConnId.get(connId);
		if (!state || state.removed) return;
		const now = Date.now();
		if (options.hasOwnProperty('idleMs')) {
			const newIdle = Math.max(0, options.idleMs || 0);
			state.idleMs = newIdle;
			state.idleWarned = false;
			state.idleVersion += 1; // invalidate pending items
			if (newIdle > 0) {
				const inactiveFor = now - state.lastActionTs;
				const nextAt = inactiveFor >= newIdle ? now : (state.lastActionTs + newIdle);
				this._heap._push({ time: nextAt, type: 'idle', connId: state.connId, version: state.idleVersion });
			}
		}
		if (options.hasOwnProperty('absoluteMs')) {
			const newAbs = Math.max(0, options.absoluteMs || 0);
			state.absoluteMs = newAbs;
			state.absoluteWarned = false;
			state.absoluteVersion += 1;
			if (newAbs > 0) {
				const aliveFor = now - state.connectTs;
				const nextAt = aliveFor >= newAbs ? now : (state.connectTs + newAbs);
				this._heap._push({ time: nextAt, type: 'absolute', connId: state.connId, version: state.absoluteVersion });
			}
		}
	}

	removeConnection(connId) {
		const state = this._stateByConnId.get(connId);
		if (!state) return;
		state.removed = true;
		this._stateByConnId.delete(connId);
		// Stale heap entries will be ignored via version/removed checks.
	}

	_scheduleIdle(state, time) {
		state.idleVersion += 1;
		this._heap._push({ time, type: 'idle', connId: state.connId, version: state.idleVersion });
	}

	_scheduleAbsolute(state, time) {
		state.absoluteVersion += 1;
		this._heap._push({ time, type: 'absolute', connId: state.connId, version: state.absoluteVersion });
	}

	async _onTick() {
		let now = Date.now();
		let top = this._heap._peek();
		while (top && top.time <= now) {
			const item = this._heap._pop();
			const state = this._stateByConnId.get(item.connId);
			if (!state || state.removed) {
				top = this._heap._peek();
				continue;
			}
			if (item.type === 'idle') {
				// Skip stale
				if (item.version !== state.idleVersion) { top = this._heap._peek(); continue; }
				await this._processIdle(state, now);
			} else if (item.type === 'absolute') {
				if (item.version !== state.absoluteVersion) { top = this._heap._peek(); continue; }
				await this._processAbsolute(state, now);
			}
			now = Date.now();
			top = this._heap._peek();
		}
	}

	async _processIdle(state, now) {
		const { idleMs } = state;
		if (idleMs <= 0) return;
		const inactiveFor = now - state.lastActionTs;
		if (inactiveFor < idleMs) {
			// Not yet expired; schedule next check for the remaining time
			this._scheduleIdle(state, now + (idleMs - inactiveFor));
			return;
		}
		if (!state.idleWarned) {
			state.idleWarned = true;
			try { await this._callbacks.onIdleWarning(state.conn, idleMs); } catch (e) {}
			// Schedule next check at the exact idle boundary from last activity,
			// or the next tick if boundary already passed.
			const boundary = state.lastActionTs + idleMs;
			const nextAt = boundary > now ? boundary : (now + this._tickMs);
			this._scheduleIdle(state, nextAt);
			return;
		}
		// Already warned and still idle -> close
		try { await this._callbacks.onIdleClose(state.conn); } catch (e) {}
		this.removeConnection(state.connId);
	}

	async _processAbsolute(state, now) {
		const { absoluteMs } = state;
		if (absoluteMs <= 0) return;
		const aliveFor = now - state.connectTs;
		if (aliveFor < absoluteMs) {
			// Not yet expired; schedule next check for remaining time
			this._scheduleAbsolute(state, now + (absoluteMs - aliveFor));
			return;
		}
		if (!state.absoluteWarned) {
			state.absoluteWarned = true;
			try { await this._callbacks.onAbsoluteWarning(state.conn); } catch (e) {}
			this._scheduleAbsolute(state, now + absoluteMs);
			return;
		}
		try { await this._callbacks.onAbsoluteClose(state.conn); } catch (e) {}
		this.removeConnection(state.connId);
	}
}

module.exports = new SessionScheduler();


