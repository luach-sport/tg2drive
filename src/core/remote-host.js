import { readJson, writeJson, STATUS_FILE, COMMANDS_FILE } from '../services/drive-appdata.js';
import { sleep } from './bytes.js';

const TICK_MS = 3000;

/**
 * Computer side of the phone link.
 * Every few seconds: publishes a status snapshot to Drive, and reads new commands the phone sent.
 */
export class RemoteHost {
  constructor({ getSnapshot, onCommand, onTick, onError }) {
    this.getSnapshot = getSnapshot;
    this.onCommand = onCommand;
    this.onTick = onTick;
    this.onError = onError;
    this.running = false;
    this.startedAt = Date.now();
    this.done = new Set();
    this.lastJson = '';
    this.lastWrite = 0;
    this.authNeeded = false;
    this.lastOk = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this._loop();
  }

  stop() {
    this.running = false;
  }

  async _loop() {
    let tick = 0;
    while (this.running) {
      try {
        if (!this.authNeeded) {
          await this._publish();
          if (tick % 2 === 0) await this._readCommands();
          this.lastOk = Date.now();
        }
      } catch (e) {
        if (e.authNeeded) this.authNeeded = true;
        this.onError?.(e);
      }
      this.onTick?.(this);
      tick++;
      await sleep(TICK_MS);
    }
  }

  async _publish() {
    const snap = this.getSnapshot();
    const json = JSON.stringify(snap);
    // write when something changed, and at least every 20s so the phone knows we're alive
    if (json === this.lastJson && Date.now() - this.lastWrite < 20000) return;
    await writeJson(STATUS_FILE, { ...snap, ts: Date.now() });
    this.lastJson = json;
    this.lastWrite = Date.now();
  }

  async _readCommands() {
    const data = await readJson(COMMANDS_FILE);
    for (const cmd of data?.cmds || []) {
      if (this.done.has(cmd.id)) continue;
      this.done.add(cmd.id);
      // only commands sent while this page is open (old ones are history)
      if (cmd.ts < this.startedAt - 60000) continue;
      try {
        await this.onCommand(cmd);
      } catch (e) {
        this.onError?.(e);
      }
    }
  }

  authRenewed() {
    this.authNeeded = false;
  }
}
