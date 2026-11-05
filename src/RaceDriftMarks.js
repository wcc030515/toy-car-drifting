import { DriftMarks } from '../vendor/reference/DriftMarks.js';

// Keep the reference trail rendering, but make its lifetime one race.
export class RaceDriftMarks extends DriftMarks {
  _load() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('racing.driftMarks.lagoon')) localStorage.removeItem(key);
      }
    } catch {}
  }

  _save() {
    // The inherited pagehide listener must never persist a completed race.
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  clear() {
    for (const trail of this.trails) {
      trail.positions.fill(0);
      for (let i = 3; i < trail.colors.length; i += 4) trail.colors[i] = 0;
      for (const attribute of Object.values(trail.geometry.attributes)) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, attribute.array.length);
        attribute.needsUpdate = true;
      }
      trail.segmentIndex = 0;
      trail.drawCount = 0;
      trail.geometry.setDrawRange(0, 0);
      trail.prev.set(0, 0, 0);
      trail.active = false;
      trail.dirty = false;
    }
    this._save();
  }
}
