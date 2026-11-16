'use strict';
window.SophyAppearance = {
  readingPreferences(value = {}) {
    return {
      fontSize: [16, 17, 19].includes(Number(value.fontSize)) ? Number(value.fontSize) : 17,
      width: [640, 720, 880].includes(Number(value.width)) ? Number(value.width) : 720,
      lineHeight: [1.6, 1.75, 1.9].includes(Number(value.lineHeight))
        ? Number(value.lineHeight)
        : 1.75,
    };
  },
  applyReading(value) {
    const prefs = this.readingPreferences(value);
    const style = document.documentElement.style;
    style.setProperty('--reading-size', prefs.fontSize + 'px');
    style.setProperty('--reading-width', prefs.width + 'px');
    style.setProperty('--reading-leading', prefs.lineHeight);
  },
  contrastInk(hex) {
    const values = hex
      .replace('#', '')
      .match(/../g)
      .map((part) => {
        const channel = parseInt(part, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    return luminance > 0.179 ? '#202936' : '#FFFFFF';
  },
};
